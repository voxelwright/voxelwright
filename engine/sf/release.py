"""Assemble and pin a local static release from full_run.py's verified outputs."""

import argparse
import fcntl
import hashlib
import json
import re
import shutil
import subprocess
import sys
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


def generate(root, out, inventory_only=False, graph_dir=None, far_index=None, panel=None):
    packs = root / "packs"
    index = json.loads((packs / "tiles/index.json").read_text())
    state = json.loads((root / "state.json").read_text())
    verified = {k: v for task in state["done"].values() for k, v in task.items()}
    files = {}
    verified_files = {}

    def record(path, name, checkpoint=True):
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if checkpoint and verified.get(str(path.relative_to(root))) != digest:
            raise ValueError(f"{path} absent or changed since verification")
        files[name] = path
        verified_files[name] = digest
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
    if far_index:
        far = json.loads(far_index.read_text())
        if far.get("version") != 1 or far["size"] != 5000 or far["bands"] != [4, 1, 0]:
            raise ValueError("unsupported far inventory")
        for key, bands in far["tiles"].items():
            if (
                not re.fullmatch(r"-?(?:0|[1-9][0-9]*)_-?(?:0|[1-9][0-9]*)", key)
                or len(bands) != 3
            ):
                raise ValueError("invalid far tile key or bands")
            for band, row in enumerate(bands):
                if row is None:
                    continue
                path = f"far/{band}/{key}.far"
                if (
                    row["path"] != path
                    or record(far_index.parent / path, path, False) != row
                ):
                    raise ValueError(f"invalid far object: {path}")
        if far.get("credit"):
            inventory["credits"] = [*CREDITS, far["credit"]]
        inventory["far"] = far
    manifest = encode(inventory)
    digest = hashlib.sha256(manifest).hexdigest()
    dest = out / "releases" / digest
    dest.mkdir(parents=True, exist_ok=True)
    if not inventory_only:
        for name, source in files.items():
            path = dest / name
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".part")
            if sys.platform == "darwin":
                # On the bake volume this produces an independent APFS clone.
                subprocess.run(["/bin/cp", "-c", source, tmp], check=True)
            else:
                shutil.copyfile(source, tmp)
            with tmp.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != verified_files[name]:
                    raise ValueError(f"{name} changed while staging")
            tmp.replace(path)
    (dest / "manifest.json").write_bytes(manifest)
    # The manifest is available for a fixed-camera candidate run before promotion.
    # Recheck the preceding pin under the same lock that moves current.json.
    if panel is None or inventory_only:
        print(digest, len(files), "objects staged; panel required to promote")
        return digest
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bay"))
    from panel_gate import check

    receipt = json.loads(panel.read_text())
    pointer = out / "current.json"
    with (out / ".promote.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prior = json.loads(pointer.read_text())["release"] if pointer.exists() else None
        if receipt["release"] != digest or receipt["previousRelease"] != prior:
            raise ValueError("panel must describe this candidate and the current predecessor")
        if prior is not None and not re.fullmatch("[a-f0-9]{64}", prior):
            raise ValueError("invalid predecessor digest")
        old = out / "releases" / prior / "panel.json" if prior else None
        floors = Path(__file__).resolve().parents[1] / "bay/panel-floors.json"
        previous = json.loads(old.read_text())["scores"] if old and old.exists() else json.loads(floors.read_text())
        check(receipt["scores"], previous)
        # Save judge evidence outside the hashed runtime manifest.
        tmp = dest / "panel.part"
        tmp.write_bytes(encode(receipt))
        tmp.replace(dest / "panel.json")
        tmp = pointer.with_suffix(".part")
        tmp.write_bytes(encode({"version": 1, "release": digest,
                                "manifest": f"releases/{digest}/manifest.json"}))
        tmp.replace(pointer)
    print(digest, len(files), "objects pinned; 32 views passed")
    return digest


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
    cli.add_argument(
        "--far", type=Path, help="far/far.json listing and its sibling band directories"
    )
    cli.add_argument("--panel", type=Path, help="scored release receipt for promotion")
    args = cli.parse_args()
    generate(args.root, args.out, args.inventory_only, args.graphs, args.far, args.panel)
