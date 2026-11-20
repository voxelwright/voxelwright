"""Apply a wall bundle to BAY1 tiles, preserving previously accepted SFPT rows and fixtures."""

import struct

import numpy as np

from facade_paint import chunk
from street_furniture import verify_tile_tail

EYE = (516467, 664023)  # UTM 551646.7, 4183597.7 in 10 cm engine cells


def park(x, z):
    return (x - EYE[0]) ** 2 + (z - EYE[1]) ** 2 < 400**2


def without_eye_trees(blob):
    h = struct.unpack_from("<16i", blob)
    x, z, step, n = h[10], h[11], h[8], h[9]
    if not (
        x - 400 <= EYE[0] < x + step * n + 400
        and z - 400 <= EYE[1] < z + step * n + 400
    ):
        return blob
    out = bytearray(blob)
    grid = 64 + 2 * h[5] ** 2
    top = np.frombuffer(out, "<i2", n * n, grid).reshape(n, n)
    cls = np.frombuffer(out, "u1", n * n, grid + 2 * n * n).reshape(n, n)
    j, i = np.ogrid[:n, :n]
    mask = park(x + (i + 0.5) * step, z + (j + 0.5) * step) & ((cls & 8) != 0)
    top[mask] = -32768
    cls[mask] &= 247
    start = grid + (4 + 2 * (h[15] & 1)) * n * n + 24 * h[12] + 12 * h[13]
    end = start + 16 * h[14]
    stems = [
        s for s in struct.iter_unpack("<4i", out[start:end]) if not park(s[0], s[1])
    ]
    struct.pack_into("<i", out, 56, len(stems))
    return (
        bytes(out[:start])
        + b"".join(struct.pack("<4i", *s) for s in stems)
        + bytes(out[end:])
    )


def records(data):
    pos = 8
    while pos < len(data):
        edge, _, w, h = struct.unpack_from("<IiHH", data, pos)
        end = pos + 12 + w * h
        yield edge, data[pos + 4 : end]
        pos = end


def apply(blob, faces, structures=None):
    blob = without_eye_trees(blob)
    h = struct.unpack_from("<16i", blob)
    if structures and h[3] == 2500:
        from frontage_tiles import details

        blob, _ = details(blob, *structures)
    if h[3] != 2500 or not faces:
        return blob
    start = 64 + 2 * h[5] ** 2 + 4 * h[9] ** 2
    end = start + 24 * h[12]
    rows = struct.iter_unpack("<6i", blob[start:end])
    start = end
    end = start + 12 * h[13]
    verts = list(struct.iter_unpack("<3i", blob[start:end]))
    extra = chunk(rows, verts, faces)
    if not extra:
        return blob
    end += 16 * h[14]
    if blob[end : end + 4] == b"SFST":
        end += 8 + 32 * struct.unpack_from("<I", blob, end + 4)[0]
    tail = blob[end:]
    verify_tile_tail(tail, h[13])
    merged = dict(records(tail))
    for edge, value in records(extra):
        if edge in merged and merged[edge] != value:
            raise ValueError("a previously painted wall has a second owner")
        merged[edge] = value
    tail = struct.pack("<4sI", b"SFPT", len(merged)) + b"".join(
        struct.pack("<I", edge) + v for edge, v in sorted(merged.items())
    )
    verify_tile_tail(tail, h[13])
    return blob[:end] + tail


def prototype(root):
    """Restore the graded T Third platforms and downtown tower bases when cutting from old city packs."""
    from frontage_tiles import ground_floors
    from transit_platforms import segments
    from compact_store import packed
    from tiles import read
    import json
    from pathlib import Path

    subjects = json.loads(Path(__file__).with_name("neighbourhoods.json").read_text())
    rods, styles = [], {}
    for row in subjects:
        if row["place"] not in ("Dogpatch", "Financial District"):
            continue
        square = row["square"]
        pack = root / "packs" / (square + ".bay")
        source = (
            root
            / "inputs"
            / (
                square
                + (".zip" if row["place"] == "Financial District" else ".json.gz")
            )
        )
        if not ((pack.is_file() or packed(pack).is_file()) and source.is_file()):
            continue
        data = read(pack)
        if row["place"] == "Dogpatch":
            rods = segments(data, source)
        else:
            styles = ground_floors(data, source)
    return (rods, styles) if rods or styles else None
