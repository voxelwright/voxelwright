"""Write what the photographs say of each building (facade_evidence.py records) into a level-0 tile's building rows.

Which rule reads which field (bay.rs `read`, `Evidence`, `front`, `measured_half`):

    record field                          tile                                     read by
    wall.palette, when wall.trusted       row[2] colour byte (bits 8 to 15)        Building.wall: every plain wall cell
    material.drawn, confidence >= 0.5     row[2] material (bits 0 to 3)            the same, and march.ts `paint`'s pattern
    (wall written)                        row[3] bit 16                            Building.wall wins over SFPT paint
    windows.ratio                         row[3] bits 17 to 23 (hundredths) + 24   front(): upper windows' half width;
                                          not written for now (see `fields`)

A building whose colour is not trusted keeps the bake's wall unless its material is brick or glass with confidence
0.6 or more: those are drawn in the material's own colour. The trim's kind stays in row[3]'s low 16 bits. Rows no
record matches are left byte for byte, and so is everything after the rows (outlines, trunks, fixtures, paint).
The far model reads the same records by the city's building number (landing/ina/looks.py `walls`).
"""

import json
import struct
from functools import lru_cache
from pathlib import Path

WALL_BIT, GLASS_BIT = 1 << 16, 1 << 24
MATERIAL_MIN, OWN_COLOUR_MIN, WINDOWS_MIN = 0.5, 0.6, 0.5


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
    mat, colour = wall & 15, wall >> 8 & 255
    flags = 0
    w, m = rec.get("wall"), rec.get("material")
    material = m["drawn"] if m and m["confidence"] >= MATERIAL_MIN else None
    if w and w["trusted"]:
        mat, colour, flags = material or mat, w["palette"], WALL_BIT
    elif material in (8, 11) and m["confidence"] >= OWN_COLOUR_MIN:
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


def apply(blob, records, stats=None):
    """The tile with its matched rows rewritten; other tiles (level 1 and 2) are returned as they are."""
    h = struct.unpack_from("<16i", blob)
    if h[3] != 2500 or not records:
        return blob
    out = bytearray(blob)
    at0 = rows_at(h)
    verts_at = at0 + 24 * h[12]
    verts = list(struct.iter_unpack("<3i", blob[verts_at : verts_at + 12 * h[13]]))
    for n in range(h[12]):
        at = at0 + 24 * n
        first, count, wall, trim = struct.unpack_from("<2iIi", blob, at)
        key = ";".join(f"{x},{z}" for x, z, _ in verts[first : first + count])
        rec = records.get(key)
        if stats is not None:
            stats["rows"] = stats.get("rows", 0) + 1
            stats["matched"] = stats.get("matched", 0) + bool(rec)
        new = rec and fields(rec, wall, trim)
        if new:
            struct.pack_into("<Ii", out, at + 8, new[0], struct.unpack("<i", struct.pack("<I", new[1]))[0])
            if stats is not None:
                stats["written"] = stats.get("written", 0) + 1
    return bytes(out)
