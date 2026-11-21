"""Assemble and pin a local static release from full_run.py's verified outputs."""

from contextlib import closing, nullcontext
import os
import argparse
import fcntl
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bay"))
from compact_store import TileStore, link_libraries, read as read_base

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


def library(kind, source, inventory, record):
    """The `life` or `cars` section: its producer's index and every object it lists, the streetcar routes with life."""
    idx = source / "index.json"
    index_record = record(idx, f"{kind}/index.json")
    listing = json.loads(idx.read_text())
    if listing.get("version") != 1:
        raise ValueError(f"unknown {kind} index")
    if kind == "life":
        entries = list(listing["life"].items())
        if listing.get("frame") != inventory["frame"] or set(listing["life"]) != set(
            inventory["names"]
        ):
            raise ValueError("life index does not cover exactly this release")
        if "transit" in listing:
            entries.append(("transit", listing["transit"]))
    else:
        entries = [(r["id"], r) for r in listing["cars"]]
    objects = {}
    for key, row in entries:
        if (
            not re.fullmatch(r"[a-zA-Z0-9_.-]+", key)
            or key in (".", "..", "index")
            or key in objects
            or row["path"] != key + ".json"
        ):
            raise ValueError(f"invalid {kind} object")
        rec = record(source / row["path"], kind + "/" + row["path"])
        if rec["sha256"] != row["sha256"] or rec["bytes"] != row["bytes"]:
            raise ValueError(f"{kind}/{key} differs from its index")
        objects[key] = rec
    return {"index": index_record, "objects": objects}


def cut(source, far, record):
    """The `far.landing` section: sf/far/landing.mjs's listing, each tile's cut checked and recorded like a band's."""
    listing = json.loads((source / "landing.json").read_text())
    eye = listing.get("eye")
    if listing.get("version") != 1 or not (
        isinstance(eye, list) and len(eye) == 3 and all(isinstance(v, (int, float)) for v in eye)
    ):
        raise ValueError("unknown landing cut")
    for key, row in listing["tiles"].items():
        path = f"far/landing/{key}.far"
        if key not in far["tiles"] or row["path"] != path or record(source / path, path) != row:
            raise ValueError(f"invalid landing object: {path}")
    return listing


def restock(out, life=None, cars=None, landing=None, base=None, far=None):
    """Stage a pinned release again with new street life, vehicles, far tiles or landing cut; every other object stays
    as it is. `far` is a far.json whose tiles replace the base's tiles of the same keys (each checked as `generate`
    checks them), and whose `wedge` and `light`, where it has them, replace the base's.

    The candidate's tiles, names, graphs and far bands are the base release's own (OUT's pin unless --base names
    another), so its panel scores carry over unchanged; it is staged beside it (APFS clones, the old release untouched)
    and its digest printed, for sf/pilot/current.json to name."""
    release = base or json.loads((out / "current.json").read_text())["release"]
    old = out / "releases" / release
    body = (old / "manifest.json").read_bytes()
    if hashlib.sha256(body).hexdigest() != release or encode(json.loads(body)) != body:
        raise ValueError("base manifest differs from its digest")
    inventory = json.loads(body)
    files = {}

    def record(path, name):
        files[name] = path
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        return {"path": name, "sha256": digest, "bytes": path.stat().st_size}

    replaced = [kind for kind, source in (("life", life), ("cars", cars)) if source]
    for kind in replaced:
        inventory[kind] = library(kind, life if kind == "life" else cars, inventory, record)
    gone = []
    if far:
        listing = json.loads(far.read_text())
        mine = inventory.get("far")
        if not mine or any(listing.get(k) != mine[k] for k in ("version", "size", "bands", "lods")):
            raise ValueError("far tiles need a release with the same far model")
        for key, bands in listing["tiles"].items():
            if key not in mine["tiles"] or len(bands) != 3:
                raise ValueError(f"far tile {key} is not the base's")
            for band, row in enumerate(bands):
                path = f"far/{band}/{key}.far"
                if row is None:
                    gone.append(path)
                elif row["path"] != path or record(far.parent / path, path) != row:
                    raise ValueError(f"invalid far object: {path}")
            mine["tiles"][key] = bands
        for key in ("wedge", "light"):
            if key in listing:
                mine[key] = listing[key]
    if landing:
        if "far" not in inventory:
            raise ValueError("a landing cut needs a release with a far model")
        inventory["far"]["landing"] = cut(landing, inventory["far"], record)
    if not files:
        raise ValueError("nothing to restock: pass --life, --cars, --far or --landing")
    manifest = encode(inventory)
    digest = hashlib.sha256(manifest).hexdigest()
    dest = out / "releases" / digest
    if dest.exists():
        raise ValueError(f"{dest} already exists")
    tmp = out / "releases" / f".restock-{digest}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    for entry in old.iterdir():
        if entry.name in (*replaced, "manifest.json") or entry.name.startswith(("panel-", ".")):
            continue
        subprocess.run(["/bin/cp", "-cR", entry, tmp / entry.name], check=True)
    if landing:
        shutil.rmtree(tmp / "far" / "landing", ignore_errors=True)
    for path in gone:
        (tmp / path).unlink(missing_ok=True)
    if (old / ".bay-store").is_symlink():
        (tmp / ".bay-store").symlink_to(os.readlink(old / ".bay-store"))
    for name, source in files.items():
        (tmp / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp / name).unlink(missing_ok=True)
        shutil.copyfile(source, tmp / name)
    (tmp / "manifest.json").write_bytes(manifest)
    tmp.rename(dest)
    print(digest, "staged with", len(files), "new objects; everything else as", release)
    return digest


def generate(
    root,
    out,
    inventory_only=False,
    graph_dir=None,
    far_index=None,
    panel=None,
    core=None,
    life=None,
    cars=None,
    paint=None,
    compact_store=None,
):
    packs = root / "packs"
    index = json.loads((packs / "tiles/index.json").read_text())
    state = json.loads((root / "state.json").read_text())
    verified = {k: v for task in state["done"].values() for k, v in task.items()}
    files = {}
    verified_files = {}

    def record(path, name, checkpoint=True):
        if path.suffix == ".bay" and not path.exists():
            body = read_base(path)
            digest, length = hashlib.sha256(body).hexdigest(), len(body)
        else:
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
                length = path.stat().st_size
        if checkpoint and verified.get(str(path.relative_to(root))) != digest:
            raise ValueError(f"{path} absent or changed since verification")
        files[name] = path
        verified_files[name] = digest
        return {"path": name, "sha256": digest, "bytes": length}

    out.mkdir(parents=True, exist_ok=True)
    wall_faces = None
    if paint:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bay"))
        from city_panel import accepted_faces
        from paint_tile import apply, prototype

        wall_faces = accepted_faces(paint)
        structures = prototype(root)
    levels = []
    with (
        closing(TileStore(compact_store)) if compact_store else nullcontext(None)
    ) as store:
        for level, spec in enumerate(index["levels"]):
            tiles = {}
            for x, z in sorted(index["tiles"][level]):
                key = f"{x}_{z}"
                path = f"tiles/{level}/{key}.bay"
                if key in tiles:
                    raise ValueError("duplicate tile")
                source = packs / path
                if store is not None:
                    data = read_base(source)
                    if hashlib.sha256(data).hexdigest() != verified.get(
                        str(source.relative_to(root))
                    ):
                        raise ValueError(f"tile changed since checkpoint: {source}")
                    if wall_faces is not None:
                        data = apply(data, wall_faces, structures)
                    if shutil.disk_usage(out).free < 17 * 2**30:
                        raise ValueError(
                            "disk reserve reached before compact release tile"
                        )
                    tiles[key] = dict(
                        path=path, bytes=len(data), sha256=store.put(data)
                    )
                else:
                    tiles[key] = record(source, path)
                    if wall_faces is not None:
                        if shutil.disk_usage(out.parent).free < 17 * 2**30:
                            raise ValueError("disk reserve reached; staging can resume")
                        blob = apply(read_base(source), wall_faces, structures)
                        sha = hashlib.sha256(blob).hexdigest()
                        if sha != tiles[key]["sha256"]:
                            cache = out / ".paint-objects" / sha
                            cache.parent.mkdir(parents=True, exist_ok=True)
                            if not cache.exists():
                                import tempfile

                                with tempfile.NamedTemporaryFile(
                                    dir=cache.parent, delete=False
                                ) as f:
                                    f.write(blob)
                                    tmp = Path(f.name)
                                tmp.replace(cache)
                            tiles[key] = record(cache, path, False)
                            if tiles[key]["sha256"] != sha:
                                raise ValueError("paint tile cache changed")
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
    for kind, source in (
        ("life", life or root / "life"),
        ("cars", cars or root / "cars"),
    ):
        if not source.exists() and not (life if kind == "life" else cars):
            continue
        inventory[kind] = library(
            kind,
            source,
            inventory,
            lambda path, name: record(path, name, False),
        )
    if far_index is None and state.get("farIndex") == "far.json":
        far_index = root / "far.json"
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
    with (out / f".stage-{digest}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if compact_store:
            locator = dest / ".bay-store"
            if locator.is_symlink():
                if locator.resolve() != Path(compact_store).resolve():
                    raise ValueError(
                        "release already references a different local store"
                    )
            else:
                locator.symlink_to(
                    os.path.relpath(Path(compact_store).resolve(), dest.resolve())
                )
        if compact_store and not inventory_only:
            link_libraries(Path(compact_store), dest, files, verified_files)
        elif not inventory_only:
            for name, source in files.items():
                path = dest / name
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".part")
                if source.suffix == ".bay" and not source.exists():
                    tmp.write_bytes(read_base(source))
                elif sys.platform == "darwin":
                    # On the bake volume this produces an independent APFS clone.
                    subprocess.run(["/bin/cp", "-c", source, tmp], check=True)
                else:
                    shutil.copyfile(source, tmp)
                with tmp.open("rb") as stream:
                    if (
                        hashlib.file_digest(stream, "sha256").hexdigest()
                        != verified_files[name]
                    ):
                        raise ValueError(f"{name} changed while staging")
                tmp.replace(path)
        tmp = dest / "manifest.part"
        tmp.write_bytes(manifest)
        tmp.replace(dest / "manifest.json")
    # The manifest is available for a fixed-camera candidate run before promotion.
    # Recheck the preceding pin under the same lock that moves current.json.
    if panel is None or inventory_only:
        print(
            digest,
            len(files) + (sum(len(l["tiles"]) for l in levels) if compact_store else 0),
            "objects staged; panel required to promote",
        )
        return digest
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bay"))
    from panel_gate import check

    receipt = json.loads(panel.read_text())
    pointer = out / "current.json"
    with (out / ".promote.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = json.loads(pointer.read_text()) if pointer.exists() else {}
        prior = current.get("release")
        core = core or Path(__file__).resolve().parents[1] / "page/core.wasm"
        spec = Path(__file__).resolve().parents[1] / "bay/neighbourhoods.json"
        for name, source in (("coreSha256", core), ("panelSpecSha256", spec)):
            if hashlib.sha256(source.read_bytes()).hexdigest() != receipt.get(name):
                raise ValueError(
                    f"panel {name} differs from the tested renderer or camera panel"
                )
        if receipt["release"] != digest or receipt["previousRelease"] != prior:
            raise ValueError(
                "panel must describe this candidate and the current predecessor"
            )
        if prior is not None and not re.fullmatch("[a-f0-9]{64}", prior):
            raise ValueError("invalid predecessor digest")
        previous_hash = current.get("panelSha256")
        if previous_hash is not None and not re.fullmatch(
            "[a-f0-9]{64}", previous_hash
        ):
            raise ValueError("invalid predecessor panel digest")
        old = (
            out / "releases" / prior / f"panel-{previous_hash}.json"
            if previous_hash
            else None
        )
        floors = Path(__file__).resolve().parents[1] / "bay/panel-floors.json"
        if previous_hash is not None and (
            not old.is_file()
            or hashlib.sha256(old.read_bytes()).hexdigest() != current["panelSha256"]
        ):
            raise ValueError("preceding pin is missing its verified panel receipt")
        previous = (
            json.loads(old.read_text())["scores"]
            if old and old.exists()
            else json.loads(floors.read_text())
        )
        check(receipt["scores"], previous)
        # Save judge evidence outside the hashed runtime manifest.
        receipt_hash = hashlib.sha256(encode(receipt)).hexdigest()
        tmp = dest / "panel.part"
        tmp.write_bytes(encode(receipt))
        tmp.replace(dest / f"panel-{receipt_hash}.json")
        tmp = pointer.with_suffix(".part")
        tmp.write_bytes(
            encode(
                {
                    "version": 1,
                    "release": digest,
                    "panelSha256": receipt_hash,
                    "manifest": f"releases/{digest}/manifest.json",
                }
            )
        )
        tmp.replace(pointer)
    print(
        digest,
        len(files) + (sum(len(l["tiles"]) for l in levels) if compact_store else 0),
        "objects pinned; 32 views passed",
    )
    return digest


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("root", type=Path)
    cli.add_argument("out", type=Path)
    cli.add_argument(
        "--compact-store",
        type=Path,
        help="retain local tiles as shared zstd bases and SFPT rows",
    )
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
    cli.add_argument(
        "--core", type=Path, help="tested core.wasm for this panel receipt"
    )
    cli.add_argument("--life", type=Path, help="life.py directory with its index")
    cli.add_argument("--cars", type=Path, help="cars.mjs directory with its index")
    cli.add_argument("--paint", type=Path, help="accepted city-paint batch receipt")
    cli.add_argument(
        "--restock",
        action="store_true",
        help="stage OUT's pinned release again with only --life, --cars, --far or --landing new (ROOT unused)",
    )
    cli.add_argument("--landing", type=Path, help="sf/far/landing.mjs directory with its landing.json")
    cli.add_argument("--base", help="with --restock, the staged release to start from instead of OUT's pin")
    args = cli.parse_args()
    if args.restock:
        restock(args.out, args.life, args.cars, args.landing, args.base, args.far)
        sys.exit()
    generate(
        args.root,
        args.out,
        args.inventory_only,
        args.graphs,
        args.far,
        args.panel,
        args.core,
        args.life,
        args.cars,
        args.paint,
        args.compact_store,
    )
