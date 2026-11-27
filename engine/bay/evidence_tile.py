"""Write what the photographs say of each building (facade_evidence.py records) into a level-0 tile's building rows.

Which rule reads which field (bay.rs `read`, `Evidence`, `front`, `measured_half`):

    record field                          tile                                     read by
    wall.palette, when wall.trusted       row[2] colour byte (bits 8 to 15)        Building.wall: every plain wall cell
    material.drawn, confidence >= 0.5     row[2] material (bits 0 to 3)            the same, and march.ts `paint`'s pattern
      (brick only where `clear_brick`)
    (wall written)                        row[3] bit 16                            Building.wall wins over SFPT paint
    windows.ratio                         row[3] bits 17 to 23 (hundredths) + 24   front(): upper windows' half width;
                                          not written for now (see `fields`)

A building whose colour is not trusted keeps the bake's wall unless its material is glass with confidence 0.6 or more:
that is drawn in glass's own colour. The trim's kind stays in row[3]'s low 16 bits. Rows no
record matches are left byte for byte, and so is everything after the rows (outlines, trunks, fixtures, paint).
The far model reads the same records by the city's building number (landing/ina/looks.py `walls`).
"""

import json
import math
import struct
from functools import lru_cache
from itertools import combinations
from pathlib import Path

from compact_store import split_tile

WALL_BIT, GLASS_BIT = 1 << 16, 1 << 24
MATERIAL_MIN, OWN_COLOUR_MIN, WINDOWS_MIN = 0.5, 0.6, 0.5
BRICK, GLASS = 8, 11
# SigLIP's "red brick" answers from a crop's colour and era more than its courses (2 px at 10 m), so at 0.5 it called
# 35 panel buildings brick, Haight-Ashbury's cream corner and North Beach's white row 1395 among them. Looked at by eye
# beside the photographs (November 21), 9 of the 61 brick calls were brick. Brick is drawn only when both views say so
# at BRICK_P or more and the wall's measured colour is a brick's: trusted, reddish (a* >= BRICK_RED) and not light
# (L* <= BRICK_L). That keeps 4 of the 9 (Castro, Chinatown, Dogpatch, SoMa's red brick) and none of the 52 others.
BRICK_P, BRICK_RED, BRICK_L = 0.85, 4.0, 62.0


def clear_brick(rec):
    """Whether a record's brick is clear enough to draw: see BRICK_P."""
    w, m = rec.get("wall") or {}, rec.get("material") or {}
    if m.get("cls") != "brick" or not w.get("trusted") or m.get("views", 0) < 2:
        return False
    # Two views that agree keep their mean as the confidence; disagreeing ones are cut to 0.6 of it (`material`).
    agree = abs(m["confidence"] - m["p"]["brick"]) < 1e-3
    import facade_evidence as fe

    L, a, _ = (float(v) for v in fe.lab(fe.linear(w["srgb"])))
    return agree and m["p"]["brick"] >= BRICK_P and a >= BRICK_RED and L <= BRICK_L


@lru_cache(maxsize=2)
def load(folder):
    """Every record under a records folder (one JSON a square), by the building's corners."""
    out = {}
    for path in sorted(Path(folder).rglob("*.json")):
        if path.name == "draw.json":
            continue
        out.update(json.loads(path.read_text()))
    return out


def fields(rec, wall, trim):
    """A building's new wall kind and trim word from its record, or None where the record changes nothing."""
    from bake import PYRAMID_CITY_ID

    if rec.get("city") == PYRAMID_CITY_ID and trim & WALL_BIT:
        return None  # appearance.py has the documented cladding for this footprint
    mat, colour = wall & 15, wall >> 8 & 255
    flags = 0
    w, m = rec.get("wall"), rec.get("material")
    material = m["drawn"] if m and m["confidence"] >= MATERIAL_MIN else None
    if material == BRICK and not clear_brick(rec):
        material = None
    if w and w["trusted"]:
        mat, colour, flags = material or mat, w["palette"], WALL_BIT
    elif material == GLASS and m["confidence"] >= OWN_COLOUR_MIN:
        mat, colour, flags = material, 0, WALL_BIT
    # The glass share is not written (bits 17 to 24 stay clear). It is a floor (windows that mirror the sky are missed):
    # on the panel it drew upper windows at a median 20% of the bay's wall against the rule's 48%, and the judge failed
    # Mission and Haight-Ashbury for narrow windows that the round-2 render did not have (November 21).
    if not flags:
        return None
    return mat | colour << 8, (trim & 0xFFFF) | flags


def rows_at(h):
    """Where a level-0 tile's building rows begin, from its 16-number head (bay.rs `read`: walls when head[15] bit 0)."""
    return 64 + 2 * h[5] ** 2 + (4 + 2 * (h[15] & 1)) * h[9] ** 2


def load_reviewed(path, frame):
    """Read the field-by-field decisions. Index a one-near-tile halo so seam copies see the same record."""
    source = json.loads(Path(path).read_text())
    if source["version"] != 1 or source["frame"] != frame or not source["credit"].strip():
        raise ValueError("invalid reviewed facade source, frame or credit")
    poses = source["poses"]  # solved camera x,z in the frame's 10 cm cells
    for pose in poses.values():
        if len(pose) != 2 or any(type(v) is not int for v in pose):
            raise ValueError("expected a solved camera position in cells")
    tiles = {}
    for key, rec in source["buildings"].items():
        if not ({"material", "palette"} & rec.keys()) or rec.keys() - {"material", "palette", "fromWall", "ends", "views", "reference"}:
            raise ValueError("expected reviewed wall fields")
        original = rec["fromWall"]
        if type(original) is not int or not 0 <= original <= 65535 or original & 15 != 9:
            raise ValueError("expected original residential plaster wall")
        if "material" in rec and (type(rec["material"]) is not int or rec["material"] not in (7, 8, 9)):
            raise ValueError("invalid reviewed wall material")
        if "palette" in rec and (type(rec["palette"]) is not int or not 1 <= rec["palette"] <= 255):
            raise ValueError("invalid reviewed palette index")
        views, ref = rec["views"], rec["reference"]
        if (not isinstance(views, list) or len(views) < 2 or ref not in poses
                or any(v not in poses or math.dist(poses[v], poses[ref]) <= 50 for v in views)
                or any(math.dist(poses[a], poses[b]) < 40 for a, b in combinations(views, 2))):
            raise ValueError("review requires spaced source cameras and a separate reference over 5 m away")
        points = [tuple(map(int, pair.split(","))) for pair in key.split(";")]
        xs, zs = zip(*points, strict=True)
        ends = rec["ends"]
        if (not ends or ends[-1] != len(points) - 1 or
                any(type(i) is not int or i - prior < 3 for i, prior in zip(ends, [-1, *ends[:-1]]))):
            raise ValueError("invalid facade outline rings")
        for x in range(min(xs) // 2500 - 1, max(xs) // 2500 + 2):
            for z in range(min(zs) // 2500 - 1, max(zs) // 2500 + 2):
                tiles.setdefault((x, z), {})[key] = rec
    return tiles, source["credit"]


def apply(blob, records, stats=None, *, reviewed=False):
    """The tile with its matched rows rewritten; other tiles (level 1 and 2) are returned as they are."""
    h = struct.unpack_from("<16i", blob)
    if h[3] != 2500 or not records:
        return blob
    out = bytearray(blob)
    at0 = rows_at(h)
    verts_at = at0 + 24 * h[12]
    verts = list(struct.iter_unpack("<3i", blob[verts_at : verts_at + 12 * h[13]]))
    if reviewed:
        _, paint = split_tile(blob)
        painted = {struct.unpack_from("<I", row)[0] for row in paint or ()}
    for n in range(h[12]):
        at = at0 + 24 * n
        first, count, wall, trim = struct.unpack_from("<2iII", blob, at)
        key = ";".join(f"{x},{z}" for x, z, _ in verts[first : first + count])
        rec = records.get(key)
        if stats is not None:
            stats["rows"] = stats.get("rows", 0) + 1
            stats["matched"] = stats.get("matched", 0) + bool(rec)
        if not rec:
            continue
        if reviewed:
            style = struct.unpack_from("<I", blob, at + 16)[0]
            # Only a generic residential wall, with no known cladding, special style or previously accepted SFPT.
            if (wall != rec["fromWall"] or not style & (1 << 16) or (style >> 17) & 3 or trim & WALL_BIT
                    or not painted.isdisjoint(range(first, first + count))):
                continue
            if rec["ends"] != [i for i, (_, _, f) in enumerate(verts[first:first + count]) if f & 4]:
                continue
            kind = (wall & ~15) | rec.get("material", wall & 15)
            if "palette" in rec:
                kind = (kind & ~0xff00) | rec["palette"] << 8
            new = kind, trim | (WALL_BIT if "palette" in rec else 0)
        else:
            new = fields(rec, wall, trim)
        if new:
            struct.pack_into("<2I", out, at + 8, *new)
            if stats is not None:
                stats["written"] = stats.get("written", 0) + 1
    return bytes(out)
