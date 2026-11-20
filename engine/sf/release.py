"""Assemble and pin a local static release from full_run.py's verified outputs."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

CREDITS = [
    "U.S. Geological Survey 3DEP",
    "USDA NAIP",
    "City and County of San Francisco (DataSF)",
    "© OpenStreetMap contributors, Overture Maps Foundation",
    "Terrain: Mapterhorn",
    "© Mapillary contributors",
]


def encode(data):
    return (
        json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode()


def generate(root, out, inventory_only=False, graph_dir=None):
    packs = root / "packs"
    index = json.loads((packs / "tiles/index.json").read_text())
    state = json.loads((root / "state.json").read_text())
    verified = {k: v for task in state["done"].values() for k, v in task.items()}
    files = {}

    def record(path, name, checkpoint=True):
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if checkpoint and verified.get(str(path.relative_to(root))) != digest:
            raise ValueError(f"{path} absent or changed since verification")
        files[name] = path
        return {"path": name, "sha256": digest, "bytes": path.stat().st_size}

    levels = []
    for level, spec in enumerate(index["levels"]):
        tiles = {}
        for x, z in sorted(index["tiles"][level]):
            key = f"{x}_{z}"
            path = f"tiles/{level}/{key}.bay"
            if key in tiles:
                raise ValueError("duplicate tile")
            tiles[key] = record(packs / path, path)
        sea = sorted(f"{x}_{z}" for x, z in index["sea"][level])
        if len(set(sea)) != len(sea) or set(sea) & tiles.keys():
            raise ValueError("overlapping inventory")
        levels.append({**spec, "level": level, "tiles": tiles, "sea": sea})
    names = {
        s: record(packs / (s + ".json"), f"names/{s}.json")
        for s in sorted(index["squares"])
    }
    inventory = {
        "version": 1,
        "frame": "10n4250",
        "levels": levels,
        "names": names,
        "credits": CREDITS,
    }
    if graph_dir or (packs / "graph").is_dir():
        source = graph_dir or packs / "graph"
        inventory["graph"] = {
            s: record(source / (s + ".json"), f"graph/{s}.json", graph_dir is None)
            for s in names
        }
    manifest = encode(inventory)
    digest = hashlib.sha256(manifest).hexdigest()
    dest = out / "releases" / digest
    dest.mkdir(parents=True, exist_ok=True)
    if not inventory_only:
        for name, source in files.items():
            path = dest / name
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".part")
            shutil.copyfile(source, tmp)
            tmp.replace(path)
    (dest / "manifest.json").write_bytes(manifest)
    pointer = out / "current.json"
    pointer.with_suffix(".part").write_bytes(
        encode(
            {
                "version": 1,
                "release": digest,
                "manifest": f"releases/{digest}/manifest.json",
            }
        )
    )
    pointer.with_suffix(".part").replace(pointer)
    print(digest, len(files), "objects")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("root", type=Path)
    cli.add_argument("out", type=Path)
    cli.add_argument("--inventory-only", action="store_true")
    cli.add_argument(
        "--graphs",
        type=Path,
        help="standalone graph output for the original pilot checkpoint",
    )
    args = cli.parse_args()
    generate(args.root, args.out, args.inventory_only, args.graphs)
