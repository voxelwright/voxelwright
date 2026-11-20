"""Decorate a staged L0 tile set from kept data. Always read a frozen, undecorated release."""

import argparse
import gzip
import json
import hashlib
import shutil
import subprocess
import sys
import struct
from pathlib import Path

from full_run import digest, save, verify
from shapely.geometry import Point
from facade_paint import chunk, load_faces
from street_furniture import decode, encode, verify_tile_tail
from street_graph import cells
from tiles import read, outline
from transit_platforms import segments
from zipfile import ZipFile


def ground_floors(pack, archive):
    with ZipFile(archive) as src:
        addresses = json.loads(src.read("addresses.geojson"))["features"]
    landmarks = [
        Point(*cells(*f["geometry"]["coordinates"]))
        for f in addresses
        if (f["properties"].get("complete_landmark_name") or "").casefold()
        == "transamerica pyramid"
    ]
    result = {}
    for verts, row in pack["buildings"]:
        heights = [((v[2] >> 8) & 65535) - row[-1] for v in verts if v[2] & 128]
        # The named civic address decides the landmark; frontal geometry comes
        # from its footprint, and office/lobby uses from the ground-floor classifier.
        if any(outline(verts).covers(point) for point in landmarks):
            style = 2
        elif (
            (row[2] >> 20) & 7 in (4, 5)
            and max(heights, default=0) > 440
            and not row[2] & (1 << 16)
        ):
            style = 3
        else:
            continue
        result[tuple(v[:2] for v in verts)] = style
    return result


def decorate(source, out, faces, rods, styles):
    data = bytearray(source.read_bytes())
    h = struct.unpack_from("<16i", data)
    at = 64 + 2 * h[5] ** 2 + (4 + 2 * (h[15] & 1)) * h[9] ** 2
    rows = list(struct.iter_unpack("<6i", data[at : at + 24 * h[12]]))
    vertices = list(
        struct.iter_unpack("<3i", data[at + 24 * h[12] : at + 24 * h[12] + 12 * h[13]])
    )
    end = at + 24 * h[12] + 12 * h[13] + 16 * h[14]
    original = decode(data[end:])
    for idx, (first, n, wall, trim, style, base) in enumerate(rows):
        special = styles.get(tuple(v[:2] for v in vertices[first : first + n]))
        if special:
            struct.pack_into(
                "<i", data, at + 24 * idx + 16, (style & ~(3 << 17)) | (special << 17)
            )
    x0, z0 = h[10], h[11]
    x1, z1 = x0 + h[9] * h[8], z0 + h[9] * h[8]
    extra = [
        r
        for r in rods
        if max(r[0], r[3]) + 10 >= x0
        and min(r[0], r[3]) - 10 < x1
        and max(r[2], r[5]) + 10 >= z0
        and min(r[2], r[5]) - 10 < z1
    ]
    paint = chunk(rows, vertices, faces)
    fixtures = encode(sorted(set(original + extra))) if extra else bytes(data[end:])
    blob = data[:end] + fixtures + paint
    verify_tile_tail(blob[end:], h[13])
    if blob != out.read_bytes():
        tmp = out.with_suffix(".part")
        tmp.write_bytes(blob)
        tmp.replace(out)
    return len(paint), len(gzip.compress(paint, mtime=0)) if paint else 0, len(extra)


def stage_manifest(manifest, candidate, changed):
    """Checkpoint an offline derivation against an immutable base pin."""
    pin = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if manifest.parent.name != pin:
        raise ValueError("base manifest directory differs from its digest")
    data = json.loads(manifest.read_text())
    checks = {}
    tiles = [level["tiles"] for level in data["levels"]]
    far = data.get("far")
    far_objects = (
        {r["path"]: r for bands in far["tiles"].values() for r in bands if r}
        if far
        else {}
    )
    for group in [*tiles, data["names"], data.get("graph", {}), far_objects]:
        for row in group.values():
            rel = Path(row["path"])
            if rel.is_absolute() or ".." in rel.parts:
                raise ValueError("invalid base object name")
            source = manifest.parent / rel
            if digest(source) != row["sha256"]:
                raise ValueError(f"base materialization differs from pin: {rel}")
            dest = candidate / "packs" / (rel.name if rel.parts[0] == "names" else rel)
            if rel.parts[0] == "far":
                dest = candidate / rel
            if rel in changed:
                if changed[rel][0] != row["sha256"] or digest(dest) != changed[rel][1]:
                    raise ValueError(f"tile changed during derivation: {rel}")
            elif not dest.exists() or digest(dest) != row["sha256"]:
                dest.parent.mkdir(exist_ok=True, parents=True)
                tmp = dest.with_suffix(".part")
                if sys.platform == "darwin":
                    subprocess.run(["/bin/cp", "-c", source, tmp], check=True)
                else:
                    shutil.copyfile(source, tmp)
                if digest(tmp) != row["sha256"]:
                    raise ValueError(f"object changed while copying: {rel}")
                tmp.replace(dest)
            checks[str(dest.relative_to(candidate))] = digest(dest)
    indexed = {Path(r["path"]) for r in tiles[0].values()}
    if not changed.keys() <= indexed:
        raise ValueError("candidate contains level-zero tiles outside the base pin")
    index = dict(
        levels=[{key: l[key] for key in ("size", "gstep")} for l in data["levels"]],
        tiles=[
            [[int(i) for i in key.split("_")] for key in l["tiles"]]
            for l in data["levels"]
        ],
        sea=[
            [[int(i) for i in key.split("_")] for key in l["sea"]]
            for l in data["levels"]
        ],
        squares=sorted(data["names"]),
    )
    if far:
        save(candidate / "far.json", far)
    save(candidate / "packs/tiles/index.json", index)
    save(
        candidate / "state.json",
        dict(baseRelease=pin, done={"verified-frontages": checks}),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "candidate", type=Path, help="independent staged copy of source"
    )
    parser.add_argument("inputs", type=Path)
    parser.add_argument("--paint", type=Path, nargs="*", default=[])
    parser.add_argument("--platforms", nargs="*", default=[])
    parser.add_argument("--towers", nargs="*", default=[])
    parser.add_argument(
        "--manifest",
        type=Path,
        help="checkpoint candidate against this local immutable base manifest",
    )
    args = parser.parse_args()
    if args.source.resolve() == args.candidate.resolve():
        parser.error("candidate needs its own staging directory")
    rods = []
    styles = {}
    for square in sorted(set(args.platforms + args.towers)):
        p = read(args.source / "packs" / (square + ".bay"))
        if square in args.platforms:
            rods += segments(p, args.inputs / (square + ".json.gz"))
        if square in args.towers:
            styles.update(ground_floors(p, args.inputs / (square + ".zip")))
    faces = load_faces(args.paint)
    changed = {}
    totals = [0, 0, 0]
    for path in sorted((args.source / "packs/tiles/0").glob("*.bay")):
        output = args.candidate / path.relative_to(args.source)
        counts = decorate(path, output, faces, rods, styles)
        if args.manifest:
            x, z = map(int, path.stem.split("_"))
            verify(output, x * 2500, z * 2500, 2500, 10, 5, 80, 0)
            changed[path.relative_to(args.source / "packs")] = digest(path), digest(
                output
            )
        totals = [a + b for a, b in zip(totals, counts)]
    if args.manifest:
        stage_manifest(args.manifest, args.candidate, changed)
    print(
        json.dumps(
            dict(
                paintBytes=totals[0],
                paintGzip=totals[1],
                rodInstances=totals[2],
                rods=len(rods),
                towers=len(styles),
                pyramids=list(styles.values()).count(2),
            )
        )
    )


if __name__ == "__main__":
    main()
