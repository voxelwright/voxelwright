"""Street-level publication passes over a BAY1 square and its retained observations."""

import gzip
import json
import struct
import zlib
from collections import Counter
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, Point, shape
from shapely.strtree import STRtree

from street_furniture import bake as furniture, encode
from earth import style
from street_sources import UTM
from mapped_water import for_square as square_water, level_of, levelled, mask as water_mask
from street_graph import cells
from bake import rings


class Square:
    def __init__(self, path):
        self.segments = []
        self.data = bytearray(path.read_bytes())
        self.h = list(struct.unpack_from("<16i", self.data))
        h = self.h
        self.at = 64

        def take(dtype, count, width):
            v = np.frombuffer(self.data, dtype, count, self.at)
            self.at += v.nbytes
            return v.reshape(-1, width)

        self.ground = take("<i2", h[5] ** 2, h[5])
        self.top = take("<i2", h[9] ** 2, h[9])
        self.cls = take("u1", h[9] ** 2, h[9])
        self.tint = take("u1", h[9] ** 2, h[9])
        self.end = self.at
        self.rows = take("<i4", h[12] * 6, 6).tolist()
        self.verts = take("<i4", h[13] * 3, 3).tolist()
        self.trunks = take("<i4", h[14] * 4, 4).tolist()
        if self.at != len(self.data) or h[4] != 10 or h[8] != 5:
            raise ValueError("expected a complete full-resolution square")
        self.g2 = np.repeat(np.repeat(self.ground[:-1, :-1], 2, 0), 2, 1)

    def write(self, path):
        self.h[12:15] = map(len, (self.rows, self.verts, self.trunks))
        tmp = path.with_suffix(".part")
        with tmp.open("wb") as out:
            out.write(struct.pack("<16i", *self.h))
            out.write(memoryview(self.data)[64 : self.end])
            for values in (self.rows, self.verts, self.trunks):
                out.write(np.asarray(values, dtype=np.int64).astype("<i4").tobytes())
            out.write(encode(self.segments))
        tmp.replace(path)

    def polygon(self, row):
        result, ring = [], []
        for x, z, flags in self.verts[row[0] : row[0] + row[1]]:
            ring.append((x, z))
            if flags & 4:
                result.append(ring)
                ring = []
        return result

    def window(self, poly):
        """A mask bounded by the square, covering this polygon's half-metre samples."""
        h = self.h
        pts = [((x - h[10]) / 5, (z - h[11]) / 5) for x, z in poly[0]]
        x0, z0 = np.floor(np.min(pts, axis=0)).astype(int).clip(0, h[9])
        x1, z1 = (np.ceil(np.max(pts, axis=0)).astype(int) + 1).clip(0, h[9])
        if x0 >= x1 or z0 >= z1:
            return None
        mask = Image.new("1", (x1 - x0, z1 - z0))
        draw = ImageDraw.Draw(mask)
        for k, ring in enumerate(poly):
            draw.polygon(
                [((x - h[10]) / 5 - x0, (z - h[11]) / 5 - z0) for x, z in ring],
                fill=int(k == 0),
            )
        return (slice(z0, z1), slice(x0, x1)), np.asarray(mask)

    def add(self, poly, window, mask, roof, seed):
        first = len(self.verts)
        for ring in poly:
            signed = sum(
                x * v - z * u for (x, z), (u, v) in zip(ring, ring[1:] + ring[:1])
            )
            for k, (x, z) in enumerate(ring):
                u, v = ring[(k + 1) % len(ring)]
                length = max(1, np.hypot(u - x, v - z))
                normal = np.array([v - z, x - u]) * (1 if signed > 0 else -1) / length
                flags = 1
                for distance in (20, 40, 65, 90):
                    i, j = np.floor(
                        (
                            (np.array([x + u, z + v]) / 2 + normal * distance)
                            - self.h[10:12]
                        )
                        / 5
                    ).astype(int)
                    if (
                        0 <= i < self.h[9]
                        and 0 <= j < self.h[9]
                        and (self.cls[j, i] & 7) in (0, 1)
                    ):
                        flags |= 2
                        break
                self.verts.append([x, z, flags | (4 if k == len(ring) - 1 else 0)])
        base = int(np.percentile(self.g2[window][mask], 5))
        self.rows.append(
            [
                first,
                len(self.verts) - first,
                *style(seed, False, (roof - base) / 10),
                base,
            ]
        )


def outlines(geometry):
    for polygon in rings(geometry):
        yield [[tuple(cells(*p[:2])) for p in ring[:-1]] for ring in polygon]


def buildings(sq, src, detail, stats):
    occupied = np.zeros(sq.top.shape, bool)
    for row in sq.rows:
        part = sq.window(sq.polygon(row))
        if part:
            w, m = part
            occupied[w] |= m
    fine = np.load(src.open("top_mm.npy")).reshape(sq.h[9], 2, sq.h[9], 2)
    measured = fine.max(axis=(1, 3))
    measured = np.where(
        measured == -2147483648, -32768, np.rint(measured / 100 - 10)
    ).astype("<i2")
    del fine
    features = json.loads(src.read("footprints.geojson"))["features"]

    def candidates():
        for f in features:
            for poly in outlines(f["geometry"]):
                yield "DataSF", f["properties"]["sf16_bldgid"], poly
        for f in detail["extraDataSF"]:
            for poly in outlines(f["geometry"]):
                yield "DataSF", f["id"], poly
        for id_, outer in detail["osmBuildings"]:
            yield "OSM", str(id_), [outer]

    flags, added, recheck = [], [], []
    for source, id_, poly in candidates():
        part = sq.window(poly)
        if part is None:
            continue
        w, m = part
        area = np.count_nonzero(m)
        if area < 16:
            continue
        seen = occupied[w][m].mean()
        ground = sq.g2[w].astype(int)
        observed = measured[w]
        high = observed > ground + 22
        supported = (m & high).sum() / area
        if source == "DataSF":
            stats["dataSFPartsChecked"] += 1
            stand = (occupied[w] & (sq.top[w] > ground + 18))[m].mean()
            if stand < 0.8:
                recheck.append((id_, poly))
                flags.append([id_, round(float(stand), 3), round(float(supported), 3)])
            if seen >= 0.8 and stand < 0.8 and supported >= 0.7:
                fix = m & high & (sq.top[w] < ground + 18)
                sq.top[w][fix] = observed[fix]
                stats["truncatedRoofSamplesRestored"] += int(fix.sum())
        if seen > 0.15 or supported < 0.7:
            continue
        # Require a compact, locally continuous elevated surface. A tall crown
        # alone must not validate an old or incorrectly aligned outline.
        roofs = observed[m & high]
        roof = int(np.median(roofs))
        flat = np.abs(observed.astype(int) - roof) <= 22
        if np.count_nonzero(m & flat) / area < 0.5:
            continue
        sq.add(poly, w, m, roof, zlib.crc32((source + id_).encode()))
        sq.top[w][m] = np.where(
            high & (np.abs(observed.astype(int) - roof) < 45), observed, roof
        )[m]
        sq.cls[w][m] &= 247
        occupied[w] |= m
        added.append([source, id_, round(area / 4, 1), roof / 10])
    stats["addedStands"] = len(added)
    remaining = []
    for id_, poly in recheck:
        w, m = sq.window(poly)
        fraction = (occupied[w] & (sq.top[w] > sq.g2[w] + 18))[m].mean()
        if fraction < 0.8:
            remaining.append([id_, round(float(fraction), 3)])
    return {"added": added, "lowCoverageDataSF": flags, "lowCoverageAfter": remaining}


def walls(sq, stats):
    """Estimate eaves on each surveyed wall from the same roof, inward of glass returns."""
    labels = np.zeros(sq.top.shape, np.int32)
    starts, ends, sign, owner, vertex = [], [], [], [], []
    for i, row in enumerate(sq.rows, 1):
        poly = sq.polygon(row)
        part = sq.window(poly)
        if not part:
            continue
        w, mask = part
        labels[w][mask] = i
        k = row[0]
        for j, ring in enumerate(poly):
            area = sum(
                x * v - z * u for (x, z), (u, v) in zip(ring, ring[1:] + ring[:1])
            )
            starts.extend(ring)
            ends.extend(ring[1:] + ring[:1])
            sign.extend([(1 if area > 0 else -1) * (-1 if j else 1)] * len(ring))
            owner.extend([i] * len(ring))
            vertex.extend(range(k, k + len(ring)))
            k += len(ring)
    # Sample in bounded batches. Only fit a level eave where the middle
    # half of the inward returns agree within 80 cm; keep pitched roof lines.
    origin = np.array(sq.h[10:12])
    for k in range(0, len(vertex), 8192):
        part = slice(k, k + 8192)
        a = np.array(starts[part])
        d = np.array(ends[part]) - a
        length = np.hypot(d[:, 0], d[:, 1])
        normal = (
            np.stack((-d[:, 1], d[:, 0]), axis=1)
            * (np.array(sign[part]) / np.maximum(length, 1))[:, None]
        )
        samples = []
        for u in (0.12, 0.35, 0.5, 0.65, 0.88):
            for inset in (8, 14, 20):
                pos = np.floor((a + d * u + normal * inset - origin) / 5).astype(int)
                x, z = pos.clip(0, sq.h[9] - 1).T
                good = (labels[z, x] == owner[part]) & (sq.top[z, x] > sq.g2[z, x] + 22)
                samples.append(np.where(good, sq.top[z, x], np.nan))
        samples = np.stack(samples, axis=1)
        enough = np.isfinite(samples).sum(1) >= 6
        if not enough.any():
            continue
        lo, mid, hi = np.nanpercentile(samples[enough], [25, 50, 75], axis=1)
        for index, roof in zip(np.where(enough)[0][hi - lo <= 8], mid[hi - lo <= 8]):
            # Bit 7 marks an absolute signed int16 eave in bits 8..23.
            sq.verts[vertex[k + index]][2] |= 128 | ((round(roof) & 65535) << 8)
            stats["surveyedWallEaves"] += 1


def facades(sq, src, detail, stats):
    lots = json.loads(src.read("landuse.geojson"))["features"]
    lots = [
        f
        for f in lots
        if f["geometry"] and f["properties"].get("geography_type") == "parcel"
    ]
    tree = STRtree([shape(f["geometry"]) for f in lots])
    for row in sq.rows:
        poly = sq.polygon(row)
        center = Polygon(poly[0], poly[1:]).representative_point()
        point = Point(UTM.transform(500000 + center.x / 10, 4250000 - center.y / 10))
        matches = tree.query(point, predicate="intersects")
        if not len(matches):
            continue
        lot = lots[matches[0]]["properties"]
        year, units, stories = detail["assessor2025"].get(
            lot.get("mapblklot"), (0, 0, 0)
        )
        if year:
            stats["datedBuildings"] += 1
        units = max(units, int(float(lot.get("resunits") or 0)))
        home = units > 0
        ground_floor = (row[4] >> 20) & 7
        if home:
            row[4] |= 1 << 16
        pts = np.array(poly[0])
        next_ = np.roll(pts, -1, axis=0)
        d = next_ - pts
        length = np.hypot(d[:, 0], d[:, 1])
        signed = np.sum(pts[:, 0] * next_[:, 1] - pts[:, 1] * next_[:, 0])
        outward = (
            np.stack((d[:, 1], -d[:, 0]), axis=1)
            / np.maximum(1, length)[:, None]
            * np.sign(signed)
        )
        mid = (pts + next_) / 2
        near = np.zeros(len(pts), bool)
        clear = np.ones(len(pts), bool)
        # Search up to 23 m outward so hillside/setback houses with front yards are still classified as street-facing (#60).
        for dist in (15, 30, 55, 80, 110, 145, 185, 230):
            ij = np.floor((mid + outward * dist - sq.h[10:12]) / 5).astype(int)
            x, z = ij.clip(0, sq.h[9] - 1).T
            clear &= (ij == ij.clip(0, sq.h[9] - 1)).all(1)
            ground = sq.cls[z, x] & 7
            near |= clear & (ground == 0)
            clear &= (sq.top[z, x] < sq.g2[z, x] + 22) | ((sq.cls[z, x] & 8) != 0)
        fronts = [
            i
            for i in range(len(pts))
            if length[i] >= 7 and (near[i] or sq.verts[row[0] + i][2] & 2)
        ]
        if not fronts:
            continue
        # Do not attach synthetic bay extrusion (`features |= 1`) when the surveyed footprint already traces faceted bays (#60).
        faceted_bays = len(pts) >= 7 and sum(1 for i in fronts if 5 <= length[i] <= 45) >= 3
        main = max(fronts, key=lambda i: length[i])
        for i in fronts:
            # Flags describe this wall, not every elevation of the parcel.
            features = 0
            if home and not faceted_bays and (not year or year < 1960) and length[i] >= 35:
                features |= 1
            # Only emit protruding flat-parapet cornices where lidar confirmed a level eave (bit 128) and the edge is
            # not an isolated short corner stub, avoiding floating white turrets on pitched gables (#60).
            has_flat_eave = bool(sq.verts[row[0] + i][2] & 128)
            if has_flat_eave and length[i] >= 14 and ((year and year < 1960) or stories >= 2):
                features |= 2
            if (
                i == main
                and home
                and ground_floor in (0, 2)
                and length[i] >= 45
                and (ground_floor == 2 or (year >= 1920 and units <= 4))
            ):
                features |= 4
            if i == main and home and ground_floor not in (1, 3, 5) and length[i] >= 25:
                features |= 8
            if ground_floor == 1 and length[i] >= 28:
                features |= 16
            if (
                i == main
                and 0 < year < 1950
                and units >= 3
                and stories >= 3
                and length[i] >= 35
            ):
                features |= 32
            sq.verts[row[0] + i][2] |= 3 | (features << 24)
            for bit, name in enumerate(
                (
                    "bayFronts",
                    "cornices",
                    "garageFronts",
                    "stoops",
                    "awningFronts",
                    "fireEscapes",
                )
            ):
                if features & (1 << bit):
                    stats[name] += 1


def streets(sq, network, stats):
    h = sq.h

    def pixel(point):
        return tuple((np.asarray(point) - h[10:12]) / 5)

    walk = Image.new("1", (h[9], h[9]))
    draw = ImageDraw.Draw(walk)
    for edge in network["pavements"]:
        if edge["kind"] in ("sidewalk", "pedestrian"):
            draw.line([pixel(p) for p in edge["line"]], fill=1, width=5)
    # Aerial NIR sees the tree over the pavement. The mapped sidewalk, or a
    # crown above grass-coloured ground alongside a kerb, identifies the paving.
    kerb = Image.new("1", (h[9], h[9]))
    edge = ImageDraw.Draw(kerb)
    for k in network["kerbs"]:
        edge.line([pixel(p) for p in k["line"]], width=11, fill=1)
    sort = sq.cls & 7
    paved = ((sort == 2) | (sort == 6)) & (
        np.asarray(walk) | (np.asarray(kerb) & ((sq.cls & 8) != 0))
    )
    sq.cls[paved] = (sq.cls[paved] & 248) | 1
    stats["pavementSamplesRestored"] = int(paved.sum())
    # Survey heights already contain the gutter/kerb step. Fit only the
    # travelled surface, excluding roofs, water and park ground at each tap.
    surface = sq.cls & 7
    hard = np.zeros(sq.ground.shape, bool)
    hard[:-1, :-1] = (surface[::2, ::2] <= 1) & (sq.ground[:-1, :-1] > -28)
    g = sq.ground.astype(float)
    total = np.zeros_like(g)
    weight = np.zeros_like(g)
    for dz in range(-3, 4):
        for dx in range(-3, 4):
            z = slice(max(0, -dz), min(h[5], h[5] - dz))
            x = slice(max(0, -dx), min(h[5], h[5] - dx))
            nz = slice(z.start + dz, z.stop + dz)
            nx = slice(x.start + dx, x.stop + dx)
            w = (
                (4 - abs(dx))
                * (4 - abs(dz))
                * hard[nz, nx]
                * (np.abs(g[z, x] - g[nz, nx]) <= 4 + 4 * np.hypot(dx, dz))
            )
            total[z, x] += w * g[nz, nx]
            weight[z, x] += w
    # Bound any change to 20 cm so a ramp or a crest keeps its grade.
    corrected = np.rint(np.clip(total / np.maximum(weight, 1), g - 2, g + 2))
    valid = hard & (weight > 0)
    stats["gradeSamplesSmoothed"] = int(np.count_nonzero(valid & (corrected != g)))
    sq.ground[valid] = corrected[valid]
    marks = Image.new("1", (h[9], h[9]))
    paint = ImageDraw.Draw(marks)
    for c in network["crossings"]:
        if c["markings"] in ("no", "unmarked"):
            continue
        a, b = map(lambda p: np.array(pixel(p)), c["line"])
        length = np.linalg.norm(b - a)
        if length < 2:
            continue
        normal = np.array([a[1] - b[1], b[0] - a[0]]) / length
        for t in np.arange(0, length, 3):
            mid = a + (b - a) * t / length
            paint.line([tuple(mid - normal * 2.5), tuple(mid + normal * 2.5)], fill=1)
    # Estimate the lip above the road grade on surveyed kerbs. Extrapolate
    # two road DEM samples across the kerb to remove the street's own slope.
    high = np.zeros(surface.shape, bool)
    for dz, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):

        def shift(a, n):
            return np.roll(a, (dz * n, dx * n), (0, 1))

        road_near = shift(surface, 2) == 0
        road_in = shift(surface, 4) == 0
        excess = (
            sq.g2.astype(np.int32)
            - 2 * shift(sq.g2.astype(np.int32), 2)
            + shift(sq.g2, 4)
        )
        high |= road_near & road_in & (excess >= 2) & (excess <= 4)
    high &= (surface == 1) & np.asarray(kerb)
    high[:4] = high[-4:] = False
    high[:, :4] = high[:, -4:] = False
    sq.cls[high] |= 128
    # Where a mapped crossing joins the pavement, lower the lip over a wheelchair width.
    ramps = Image.new("1", (h[9], h[9]))
    ramp = ImageDraw.Draw(ramps)
    for c in network["crossings"]:
        for pt in c["line"]:
            x, z = pixel(pt)
            ramp.ellipse((x - 2, z - 2, x + 2, z + 2), fill=1)
    flush = np.asarray(ramps) & (surface == 1)
    sq.cls[flush] = (sq.cls[flush] & 127) | 32
    stats["raisedKerbSamples"] = int((high & ~flush).sum())
    stats["flushCrossingSamples"] = int(flush.sum())
    stripes = np.asarray(marks) & (surface == 0)
    stats["newCrosswalkSamples"] = int((stripes & ((sq.cls & 32) == 0)).sum())
    sq.cls[stripes] |= 32


def inland_water(sq, detail, stats):
    """Stamp retained OSM inland water polygons (park ponds, lagoons, fountains) onto the surface class grid
    so elevated water bodies are rendered as reflective WATER rather than concrete YARD (#60)."""
    records = square_water(detail.get("square"), detail)
    if not records:
        return
    sample = np.arange(sq.h[9]) * sq.h[8]
    inside = water_mask(records, sq.h[10] + sample, sq.h[11] + sample)
    ground = sq.cls & 7
    # Aerial classification calls much of McBean Pond pavement. Keep roads and the mapped island.
    paint = inside & (ground != 0) & (ground != 5)
    sq.cls[paint] = (sq.cls[paint] & 248) | 5
    stats["inlandWaterSamples"] += int(paint.sum())
    # The renderer's water stands on the 1 m ground, and the DEM under a pond is a TIN across it: contours and a
    # triangle in the reflection. A surveyed body is one level, out to every sample a water cell's height is
    # interpolated from (core bay.rs `ground_height`), so the bank rises from the waterline and not inside the water.
    # A path or bridge sample (road in the 50 cm cells round it) keeps its own height, and islands stay dry.
    records = [r for r in records if level_of(r) is not None]
    if not records:
        return
    n = sq.h[5]
    corners = lambda cells: np.pad(cells, ((1, 0), (1, 0)))[: 2 * n, : 2 * n].reshape(-1, 2, n, 2).any(axis=(1, 3))
    sized = lambda cells: np.pad(cells, ((0, 2 * n - cells.shape[0]), (0, 2 * n - cells.shape[1])))
    keep = corners(sized((sq.cls & 7) == 0))
    wet = (sq.cls & 7) == 5

    def reach(record):
        # Cells 2i and 2i+1 lie between samples i and i+1.
        pairs = sized(water_mask([record], sq.h[10] + sample, sq.h[11] + sample) & wet).reshape(n, 2, n, 2).any(axis=(1, 3))
        pairs[1:] |= pairs[:-1].copy()
        pairs[:, 1:] |= pairs[:, :-1].copy()
        return pairs
    ground = sq.h[6] + np.arange(n) * sq.h[4], sq.h[7] + np.arange(n) * sq.h[4]
    moved = levelled(records, *ground, sq.ground, lambda m: round((m - 1.0) * 10), keep, reach)
    stats["levelledWaterSamples"] += moved
    if moved and hasattr(sq, "g2"):
        sq.g2 = np.repeat(np.repeat(sq.ground[:-1, :-1], 2, 0), 2, 1)


def apply(path, archive, sidecar, graph, stage=5, *, public_works_fixtures):
    sq = Square(path)
    stats = Counter()
    with zipfile.ZipFile(archive) as src, gzip.open(sidecar) as observations:
        detail = json.load(observations)
        if detail["version"] != 1 or detail["square"] != path.stem:
            raise ValueError("incorrect street detail input")
        audit = buildings(sq, src, detail, stats)
        inland_water(sq, detail, stats)
        if stage >= 2:
            walls(sq, stats)
        if stage >= 3:
            facades(sq, src, detail, stats)
        if stage >= 4:
            network = json.loads(graph.read_text())
            streets(sq, network, stats)
        if stage >= 5:
            survey = None
            if public_works_fixtures:
                fixture_file = sidecar.with_name(path.stem + ".fixtures.json.gz")
                with gzip.open(fixture_file) as file:
                    survey = json.load(file)
                if survey["square"] != path.stem or survey["version"] != 2:
                    raise ValueError("incorrect street furniture input")
            with gzip.open(sidecar.with_name(path.stem + ".stops.json.gz")) as file:
                stops = json.load(file)
            if stops["square"] != path.stem or stops["version"] != 1:
                raise ValueError("incorrect stop-sign observations")
            sq.segments = furniture(
                sq, src, detail, survey, stops["points"], network, stats
            )
    sq.write(path)
    return dict(stats), audit
