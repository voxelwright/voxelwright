"""Refine a verified square from its retained observations without network access."""

import gzip
import io
import json
import math
import struct
import zipfile
from collections import Counter
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from bake import palette, grow
from frontage import rotation
from street_graph import cells


def enhance(pack, archive, observations, graph):
    buf = bytearray(pack.read_bytes())
    h = struct.unpack_from("<16i", buf)
    gw, tw = h[5], h[9]
    pos = 64

    def take(dtype, size):
        nonlocal pos
        v = np.frombuffer(buf, dtype, size, pos)
        pos += v.nbytes
        return v

    ground = take("<i2", gw**2).reshape(gw, gw)
    top = take("<i2", tw**2).reshape(tw, tw)
    cls = take("u1", tw**2).reshape(tw, tw)
    tint = take("u1", tw**2).reshape(tw, tw)
    rows = take("<i4", 6 * h[12]).reshape(-1, 6)
    verts = take("<i4", 3 * h[13]).reshape(-1, 3)
    trunks = take("<i4", 4 * h[14]).reshape(-1, 4)
    stats = Counter()
    network = json.loads(graph.read_text())
    with zipfile.ZipFile(archive) as src:
        # Keep roof relief and parapets. The second highest of four measured subcells
        # rejects a single high return; retain the old roof where coverage is sparse.
        ids = np.load(src.open("footprint.npy"))[1::2, 1::2]
        fine = np.load(src.open("top_mm.npy")).reshape(tw, 2, tw, 2)
        heights = np.sort(fine.transpose(0, 2, 1, 3).reshape(tw, tw, 4), axis=2)[
            :, :, 2
        ]
        inside = (ids > 0) & ~grow(ids == 0, 2)
        roof_cells = np.rint((heights.astype(float) / 1000 - 1) * 10)
        use = inside & (heights != -2147483648) & (np.abs(roof_cells - top) < 15)
        stats["roofCells"] = int(np.sum(use & (roof_cells != top)))
        top[use] = roof_cells[use].astype("<i2")
        del fine, heights, roof_cells
        # A mapped sidewalk running at least six metres under one roof is evidence
        # for a covered public frontage. Require sampled points inside its outline.
        covered = Counter()
        for pavement in network["pavements"]:
            if pavement["kind"] != "sidewalk":
                continue
            a, b = np.array(pavement["line"], dtype=float)
            length = np.linalg.norm(b - a)
            if length < 10:
                continue
            for t in np.arange(5, length, 10):
                x, z = a + (b - a) * t / length
                i, j = int((x - h[10]) // 5), int((z - h[11]) // 5)
                if 1 <= i < tw - 1 and 1 <= j < tw - 1:
                    fid = ids[j, i]
                    if fid and (ids[j - 1 : j + 2, i - 1 : i + 2] == fid).all():
                        covered[int(fid)] += 1

        # Survey and imagery define the crown outline. Median of radial distances
        # limits contamination from neighbouring overhanging crowns.
        for trunk in trunks:
            x, z = ((trunk[:2] - h[10:12]) // 5).tolist()
            widths = []
            for theta in np.arange(12) * math.pi / 6:
                for r in range(1, 14):
                    i, j = (
                        x + round(r * math.cos(theta)),
                        z + round(r * math.sin(theta)),
                    )
                    if not (0 <= i < tw and 0 <= j < tw and cls[j, i] & 8):
                        break
                widths.append(r * 5)
            radius = round(float(np.median(widths)))
            if radius >= 10:
                trunk[3] = (int(trunk[3]) & 255) | min(64, radius) << 8
                stats["crowns"] += 1

        def xy(point):
            return ((point[0] - h[10]) / 5, (point[1] - h[11]) / 5)

        # Some DataSF parcels include the travelled roadway (e.g. Columbus
        # Avenue). Recover its usable width from lane counts and surveyed kerbs.
        # Opposing directed edges share one OSM centreline.
        lanes = Counter()
        for segment in network["roads"]:
            a, b = map(tuple, segment["line"])
            lanes[tuple(sorted((a, b)))] += segment["lanes"]
        centre, corridor, curbs = (Image.new("1", (tw, tw)) for _ in range(3))
        axis, band, barrier = map(ImageDraw.Draw, (centre, corridor, curbs))
        for (a, b), count in lanes.items():
            pts = [xy(a), xy(b)]
            axis.line(pts, fill=1)
            band.line(pts, fill=1, width=min(40, max(6, round(count * 6.2))))
        for line in network["kerbs"]:
            barrier.line([xy(p) for p in line["line"]], fill=1)
        usable = (
            np.asarray(corridor) & ~np.asarray(curbs) & (ids == 0) & ((cls & 7) != 5)
        )
        repaired = np.asarray(centre) & usable
        for _ in range(20):
            repaired = grow(repaired) & usable
        stats["roadCellsRecovered"] = int(np.sum(repaired & ((cls & 7) != 0)))
        cls[repaired] &= 248
        # NAIP bright neutral pixels on the mapped road surface give lane paint.
        rgb = np.asarray(Image.open(src.open("naip.png")).convert("RGB")).astype(
            np.int16
        )
        m = (rgb.shape[0] - tw) // 2
        rgb = rgb[m : m + tw, m : m + tw]
        road = (cls & 7) == 0
        pale = (rgb.min(2) > 157) & (rgb.max(2) - rgb.min(2) < 45)
        # A painted line is brighter than asphalt on both sides at this scale.
        val = rgb.mean(2)
        peak = np.zeros(road.shape, bool)
        for axis in (0, 1):
            peak |= (
                val - np.maximum(np.roll(val, 3, axis), np.roll(val, -3, axis))
            ) > 30
        cls[road & pale & peak] |= 32
        marks = Image.new("L", (tw, tw))
        draw = ImageDraw.Draw(marks)
        for c in network["crossings"]:
            if c["markings"] in (None, "no", "unmarked"):
                continue
            a, b = np.array([xy(p) for p in c["line"]])
            length = np.linalg.norm(b - a)
            if length < 1:
                continue
            normal = np.array([a[1] - b[1], b[0] - a[0]]) / length
            for t in np.arange(0, length, 3):
                mid = a + (b - a) * t / length
                draw.line([tuple(mid - normal * 2), tuple(mid + normal * 2)], fill=32)
        for track in network["tracks"]:
            a, b = np.array([xy(p) for p in track["line"]])
            length = np.linalg.norm(b - a)
            if length:
                normal = np.array([a[1] - b[1], b[0] - a[0]]) / length
                for shift in (-1.067, 1.067):
                    draw.line(
                        [tuple(a + normal * shift), tuple(b + normal * shift)], fill=64
                    )
        cls[road] |= np.asarray(marks)[road]
        stats["paintCells"] = int(np.count_nonzero(cls & 32))
        stats["railCells"] = int(np.count_nonzero(cls & 64))

        lots = json.loads(src.read("landuse.geojson"))["features"]
        geoms = [shape(f["geometry"]) for f in lots]
        tree = STRtree(geoms)
        uses = {}
        for business in json.load(gzip.open(observations))["businesses"]:
            point = Point(business["location"]["coordinates"])
            for i in tree.query(point, predicate="intersects"):
                code = business.get("self_reported_naics_code", "")[:2]
                uses.setdefault(i, set()).add(
                    "garage" if business.get("parking_tax") else code
                )
        addresses = set()
        for f in json.loads(src.read("addresses.geojson"))["features"]:
            if f["geometry"]:
                addresses.update(
                    tree.query(shape(f["geometry"]), predicate="intersects")
                )
        footprints = json.loads(src.read("footprints.geojson"))["features"]
        centers = []
        footprint_ids = []
        for fid, f in enumerate(footprints, 1):
            g = shape(f["geometry"])
            footprint_ids.extend(
                fid for part in getattr(g, "geoms", [g]) if not part.is_empty
            )
            centers.extend(
                part.representative_point()
                for part in getattr(g, "geoms", [g])
                if not part.is_empty
            )
        if len(centers) != len(rows):
            raise ValueError("building order differs from source footprints")
        cams = []
        for p in json.loads(src.read("photos/cameras.json")):
            if p.get("camera_type") != "spherical":
                continue
            x, z = cells(*p["computed_geometry"]["coordinates"])
            i, j = (x - h[6]) // 10, (z - h[7]) // 10
            if 0 <= i < gw and 0 <= j < gw:
                cams.append(
                    (
                        x,
                        z,
                        int(ground[j, i]) + 25,
                        rotation(np.array(p["computed_rotation"])),
                        p["id"],
                    )
                )

        @lru_cache(maxsize=12)
        def photo(id_):
            return np.asarray(
                Image.open(io.BytesIO(src.read("photos/" + id_ + ".jpg"))).convert(
                    "RGB"
                )
            )

        table = palette()[1:] * 255
        cx = np.array([c[0] for c in cams])
        cz = np.array([c[1] for c in cams])
        for building, row in enumerate(rows):
            lot = tree.query(centers[building], predicate="intersects")
            if len(lot):
                i = lot[0]
                p = lots[i]["properties"]
                business = uses.get(i, set())
                kind = 0
                if p.get("garage") is True or "garage" in business:
                    kind = 2
                elif float(p.get("retail") or 0) > 0 or business & {"44", "45", "72"}:
                    kind = 1
                elif float(p.get("pdr") or 0) > 0:
                    kind = 3
                elif float(p.get("mips") or 0) > 0 and i in addresses:
                    kind = 4
                if kind:
                    row[4] = (int(row[4]) & ~(7 << 20)) | kind << 20
                    stats[["", "shopfront", "garage", "loading", "lobby"][kind]] += 1
            vs = verts[row[0] : row[0] + row[1]]
            samples = []
            paint_panels = []
            recess = []
            start = 0
            for k, (x, z, flags) in enumerate(vs.tolist()):
                end = vs[start if flags & 4 else k + 1]
                if flags & 4:
                    start = k + 1
                if not flags & 1:
                    continue
                dx, dz = end[0] - x, end[1] - z
                length = math.hypot(dx, dz)
                if length < 25:
                    continue
                mx, mz = x + dx * 0.5, z + dz * 0.5
                distances = np.hypot(cx - mx, cz - mz)
                for cidx in np.argsort(distances)[:2]:
                    dist = distances[cidx]
                    if not 45 < dist < 430:
                        continue
                    a, b, y, R, id_ = cams[cidx]
                    if abs((mx - a) * dx + (mz - b) * dz) > dist * length * 0.8:
                        continue
                    # Test the path, including vegetation, from the camera to the wall.
                    t = np.linspace(0, 0.91, max(3, int(dist / 5)))
                    ii = ((a + t * (mx - a) - h[10]) / 5).astype(int).clip(0, tw - 1)
                    jj = ((b + t * (mz - b) - h[11]) / 5).astype(int).clip(0, tw - 1)
                    wall_y = max(int(row[5]) + 42, y + 8)
                    if np.any(top[jj, ii] > y + t * (wall_y - y)):
                        continue
                    pts = np.array(
                        [
                            [x + dx * u - a, -(z + dz * u - b), wall_y + v - y]
                            for u in (0.25, 0.4, 0.6, 0.75)
                            for v in (-8, 0, 8)
                        ]
                    )
                    vec = pts @ R.T
                    img = photo(id_)
                    u = (
                        (np.arctan2(vec[:, 0], vec[:, 2]) / (2 * np.pi) + 0.5)
                        % 1
                        * img.shape[1]
                    ).astype(int)
                    v = (
                        (
                            0.5
                            + np.arctan2(vec[:, 1], np.hypot(vec[:, 0], vec[:, 2]))
                            / np.pi
                        )
                        * img.shape[0]
                    ).astype(int)
                    pixels = img[v.clip(0, img.shape[0] - 1), u].astype(float)
                    ok = (
                        (pixels.mean(1) > 50)
                        & (pixels.mean(1) < 230)
                        & (pixels[:, 1] < 1.12 * np.maximum(pixels[:, 0], pixels[:, 2]))
                    )
                    if (
                        ok.sum() >= 10
                        and np.max(np.std(pixels[ok], axis=0)) < 18
                        and flags & 2
                        and dist < 300
                    ):
                        paint_panels.append(np.median(pixels[ok], axis=0))
                    # Compare the opening to the wall above it in this same exposure.
                    if flags & 2 and covered[footprint_ids[building]] >= 6:
                        low = pts.copy()
                        low[:, 2] -= 25
                        lv = low @ R.T
                        lx = (
                            (np.arctan2(lv[:, 0], lv[:, 2]) / (2 * np.pi) + 0.5)
                            % 1
                            * img.shape[1]
                        ).astype(int)
                        ly = (
                            (
                                0.5
                                + np.arctan2(lv[:, 1], np.hypot(lv[:, 0], lv[:, 2]))
                                / np.pi
                            )
                            * img.shape[0]
                        ).astype(int)
                        recess.append(
                            float(np.median(img[ly.clip(0, img.shape[0] - 1), lx]))
                            < 0.7 * float(np.median(pixels))
                        )
                    if ok.sum() >= 6:
                        samples.append((id_, np.median(pixels[ok], axis=0)))
            if recess and np.mean(recess) >= 0.65:
                row[4] = (int(row[4]) & ~(7 << 20)) | 5 << 20
                stats["arcade"] += 1
            if samples:
                rgb = np.median([c for _, c in samples], axis=0)
                agrees = (
                    len({i for i, c in samples if np.linalg.norm(c - rgb) < 40}) >= 2
                )
                if not agrees and paint_panels:
                    rgb = np.median(paint_panels, axis=0)
                    agrees = all(np.linalg.norm(c - rgb) < 30 for c in paint_panels)
                if agrees:
                    mat = (
                        8
                        if rgb[0] > rgb[1] * 1.35 and rgb[0] < 180
                        else (9 if int(row[4]) & (1 << 16) else 7)
                    )
                    row[2] = (
                        mat | (int(np.argmin(((table - rgb) ** 2).sum(1))) + 1) << 8
                    )
                    stats["photoWalls"] += 1
    temp = pack.with_suffix(".part")
    temp.write_bytes(buf)
    temp.replace(pack)
    return dict(stats)
