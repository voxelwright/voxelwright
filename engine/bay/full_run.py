"""Build a local release of SF. See README.md. Does not upload."""

import argparse
import fcntl
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time
import traceback
from collections import defaultdict
from pathlib import Path

from coverage import bounds, tile_keys

HERE = Path(__file__).resolve().parent
BAY = Path.home() / ".village/engine/bay"
PILOT = [
    "550.7_4182.5",
    "550.7_4183.5",
    "551.7_4182.5",
    "551.7_4183.5",
    "551.7_4184.5",
    "552.7_4183.5",
]
RADIUS = (500, 4000, 16000)  # includes the desktop clip boxes' sector alignment


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def save(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    tmp.replace(path)


def verify(path, x, z, size, gstep, tstep, margin, walls):
    with path.open("rb") as f:
        h = struct.unpack("<16i", f.read(64))
    ground_margin = margin if size == 10000 and gstep == 10 else 0
    grid = (size + 2 * ground_margin) // gstep + 1
    expected = (
        0x31594142,
        x,
        z,
        size,
        gstep,
        grid,
        x - ground_margin,
        z - ground_margin,
        tstep,
        (size + 2 * margin) // tstep,
        x - margin,
        z - margin,
    )
    if h[:12] != expected or h[15] != walls or min(h[12:15]) < 0:
        raise ValueError(f"incorrect BAY1 header: {path}")
    length = (
        64
        + 2 * h[5] ** 2
        + (4 + 2 * walls) * h[9] ** 2
        + 24 * h[12]
        + 12 * h[13]
        + 16 * h[14]
    )
    if path.stat().st_size != length:
        raise ValueError(f"truncated BAY1: {path}")
    with path.open("rb") as f:
        f.seek(64 + 2 * h[5] ** 2 + (4 + 2 * walls) * h[9] ** 2)
        for first, count, *_ in struct.iter_unpack("<6i", f.read(24 * h[12])):
            if first < 0 or count < 3 or first + count > h[13]:
                raise ValueError(f"invalid building vertex range: {path}")


def plan(names, planet, horizon):
    contributors = defaultdict(list)
    blended = set()
    for name in names:
        blended.update(tile_keys(name, (16, 16, 16)))
        for key in tile_keys(name, (24, 24, 48)):
            contributors[key].append(name)
    needed = set(blended)
    if horizon:
        for name in names + planet:
            needed.update(tile_keys(name, RADIUS))
    return {k: contributors[k] if k in blended else [] for k in sorted(needed)}


def build(args, lock_fd):
    import earth
    import tiles

    root = args.output.resolve()
    packs = root / "packs"
    square_list = json.loads((HERE / "sf-squares.json").read_text())
    names = PILOT if args.pilot else square_list["lidar"]
    keys = plan(names, square_list["planet"], not args.pilot)
    recipe = [
        digest(HERE / f)
        for f in (
            "full_run.py",
            "intermediate.py",
            "panoramas.py",
            "appearance.py",
            "street_graph.py",
            "street_sources.py",
            "coverage.py",
            "sf-squares.json",
            "bake.py",
            "dem.py",
            "earth.py",
            "fetch.py",
            "tiles.py",
            "frontage.py",
            "street_trees.py",
            "pilot-hashes.json",
            "pilot-frontages.json",
        )
    ]
    recipe += [args.pilot]
    statefile = root / "state.json"
    state = (
        json.loads(statefile.read_text())
        if statefile.exists()
        else {"recipe": recipe, "done": {}}
    )
    if state["recipe"] != recipe:
        raise SystemExit("recipe changed: use a fresh release directory")
    if not statefile.exists() and any(p.name != "build.lock" for p in root.iterdir()):
        raise SystemExit("choose an empty output directory for a new release")
    save(statefile, state)
    packs.mkdir(exist_ok=True)
    logs = root / "logs"
    logs.mkdir(exist_ok=True)
    env = {**os.environ, "VILLAGE_BAY_ROOT": str(root)}
    tiles.PACKS = str(packs)

    def task(id_, make, *inputs):
        previous = state["done"].get(id_)
        if previous is not None:
            for rel, sha in previous.items():
                if digest(root / rel) != sha:
                    raise ValueError(
                        f"{rel} changed after verification: restore it or use a new output directory"
                    )
            return previous
        for attempt in range(3):
            if shutil.disk_usage(root).free < args.free_gib * 2**30:
                raise SystemExit(
                    f"low disk before {id_}; state saved; resume with the same command"
                )
            with (logs / f"{id_}.log").open("a", buffering=1) as log:
                print(time.ctime(), "attempt", attempt + 1, file=log)
                try:
                    result = {
                        str(p.relative_to(root)): digest(p) for p in make(log, *inputs)
                    }
                    state["done"][id_] = result
                    save(statefile, state)
                    return result
                except Exception:
                    traceback.print_exc(file=log)
                    if attempt == 2:
                        raise
            time.sleep(2 ** (attempt + 1))

    seeds = json.loads((HERE / "pilot-hashes.json").read_text())

    from intermediate import restore, write
    from panoramas import acquire
    import street_graph, street_sources

    from appearance import enhance

    def keep(log, name):
        dest = root / "inputs" / (name + ".zip")
        seed = args.input_seed / dest.name
        if seed.exists():
            import zipfile

            with zipfile.ZipFile(seed) as archive:
                if (
                    archive.testzip()
                    or json.loads(archive.read("frame.json"))["square"] != name
                ):
                    raise ValueError("invalid pilot intermediate")
            dest.parent.mkdir(exist_ok=True)
            shutil.copyfile(seed, dest)
        else:
            if args.offline_inputs:
                raise ValueError(f"offline input missing: {seed}")
            subprocess.run(
                [sys.executable, HERE / "fetch.py", name],
                env=env,
                stdout=log,
                stderr=log,
                check=True,
                pass_fds=(lock_fd,),
            )
            raw = root / "raw" / name
            write(raw, dest, acquire(raw))
        return [dest]

    def square(log, name):
        pack, meta = packs / f"{name}.bay", packs / f"{name}.json"
        # Only accept byte-identical pairs measured in this pilot.
        seed = seeds.get(name)
        source = args.seed
        if (
            seed
            and source
            and all(
                (source / p.name).is_file()
                and digest(source / p.name) == seed[p.suffix]
                for p in (pack, meta)
            )
        ):
            for p in (pack, meta):
                shutil.copyfile(source / p.name, p)
            print("verified pilot seed", file=log)
        else:
            restore(root / "inputs" / (name + ".zip"), root / "raw" / name)
            for script in ("bake.py",):
                subprocess.run(
                    [sys.executable, HERE / script, name],
                    env=env,
                    stdout=log,
                    stderr=log,
                    check=True,
                    pass_fds=(lock_fd,),
                )
            from frontage import apply
            from street_trees import align

            align(pack, root / "raw" / name / "trees.geojson")
            observations = json.loads((HERE / "pilot-frontages.json").read_text()).get(
                name, {}
            )
            if observations:
                apply(pack, pack, observations)
                names_data = json.loads(meta.read_text())
                names_data["credit"] += "; façade colours: Mapillary"
                save(meta, names_data)
        result = enhance(
            pack,
            root / "inputs" / (name + ".zip"),
            root / "inputs" / (name + ".json.gz"),
            packs / "graph" / (name + ".json"),
        )
        print("appearance", json.dumps(result), file=log)
        x, z, _, _ = bounds(name)
        verify(pack, x * 10, z * 10, 10000, 10, 5, 160, 0)
        data = json.loads(meta.read_text())
        if (
            data["square"] != name
            or data["at"] != [x * 10, z * 10, 10000]
            or not all(
                isinstance(data[k], list) for k in ("names", "ways", "addresses")
            )
        ):
            raise ValueError("incorrect names file")
        return [pack, meta]

    for name in dict.fromkeys(PILOT + names):
        task("inputs-" + name, keep, name)
        observations = root / "inputs" / (name + ".json.gz")

        def streets(log, square_name):
            cached = args.street_seed / observations.name
            if cached.exists():
                shutil.copyfile(cached, observations)
            else:
                if args.offline_inputs:
                    raise ValueError(f"offline street input missing: {cached}")
                street_sources.acquire(square_name, observations)
            path = packs / "graph" / (square_name + ".json")
            street_graph.build(
                square_name,
                root / "inputs" / (square_name + ".zip"),
                observations,
                path,
            )
            return [observations, path]

        task("streets-" + name, streets, name)
        task(name, square, name)
        print(time.ctime(), "verified square", name, flush=True)
        raw = root / "raw" / name
        if raw.is_dir():
            shutil.rmtree(
                raw
            )  # this run's private staging area, after both outputs were recorded

    index = {
        "levels": [{"size": r[0], "gstep": r[1]} for r in earth.LEVELS],
        "squares": names,
        "tiles": [[], [], []],
        "sea": [[], [], []],
    }
    groups = defaultdict(list)
    for key, inputs in keys.items():
        level, x, z = key
        # Amortise rasterisation over locally adjacent tiles with identical input lists.
        groups[
            level,
            x // 4 if level == 0 else x,
            z // 4 if level == 0 else z,
            tuple(inputs),
        ].append(key)

    def group_output(log, level, inputs, group):
        size, gstep, tstep, margin, _ = earth.LEVELS[level]
        if inputs:
            result = tiles.cut([packs / f"{name}.bay" for name in inputs], set(group))
            if {(level, x, z) for x, z in result["tiles"][level]} != set(group):
                raise ValueError(f"incomplete tile group {group}")
        paths = []
        for _, x, z in group:
            path = packs / "tiles" / str(level) / f"{x}_{z}.bay"
            if not inputs:
                frame = earth.Frame(tiles.FRAME)
                blob = earth.tile_bytes(frame, level, x, z)
                if not blob:
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".part")
                tmp.write_bytes(blob)
                tmp.replace(path)
            verify(
                path, x * size, z * size, size, gstep, tstep, margin, int(level != 0)
            )
            paths.append(path)
        print(group, inputs, len(paths), "nonempty", file=log)
        return paths

    for number, ((level, _, __, inputs), group) in enumerate(groups.items()):
        files = task(f"tiles-{number}", group_output, level, inputs, group)
        for _, x, z in group:
            present = f"packs/tiles/{level}/{x}_{z}.bay" in files
            index["tiles" if present else "sea"][level].append([x, z])
    save(packs / "tiles/index.json", index)
    print(
        len(names),
        "squares;",
        *[len(k) for k in index["tiles"]],
        "tile files;",
        sum(map(len, index["sea"])),
        "sea keys",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=BAY / "sf-450-release")
    parser.add_argument("--street-seed", type=Path, default=BAY / "450-street-inputs")
    parser.add_argument(
        "--offline-inputs",
        action="store_true",
        help="require both retained observations for every square; no square source acquisition",
    )
    parser.add_argument("--input-seed", type=Path, default=BAY / "450-inputs")
    parser.add_argument("--seed", type=Path, default=BAY / "pilot450/packs")
    parser.add_argument(
        "--pilot", action="store_true", help="only six squares, no horizon"
    )
    parser.add_argument("--free-gib", type=float, default=15)
    args = parser.parse_args()
    if not math.isfinite(args.free_gib) or args.free_gib <= 0:
        parser.error("free disk threshold must be positive")
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        build(args, lock.fileno())
