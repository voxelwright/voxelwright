"""Hash the affected publication tiles, including windows outside the recognition panel."""

from collections import defaultdict
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from city_paint import CITY, HERE, PILOT, SEEDS
from facade_paint import edges, FaceLibrary
from full_run import digest, plan
from paint_tile import apply
import tiles


def measure(root, members, previous):
    from city_panel import bundles

    new = {k: v for k, v in members.items() if k not in previous}
    by_square = defaultdict(list)
    for name, path in zip(new, bundles(root, new)):
        by_square[name.rsplit("-", 2)[0]].append(path)
    keys = set()
    for square, paths in by_square.items():
        fresh = FaceLibrary(paths)
        if not fresh:
            continue
        for vertices, _ in tiles.read(CITY / "packs" / (square + ".bay"))["buildings"]:
            if not any(key in fresh for _, key, _ in edges(vertices)):
                continue
            xs, zs, _ = zip(*vertices)
            for x in range((min(xs) - 80) // 2500, (max(xs) + 80) // 2500 + 1):
                for z in range((min(zs) - 80) // 2500, (max(zs) + 80) // 2500 + 1):
                    keys.add((0, x, z))
    state = json.loads((CITY / "state.json").read_text())["done"]
    all_squares = json.loads((HERE / "sf-squares.json").read_text())["lidar"]
    planned = plan(all_squares, [], False)
    groups = defaultdict(set)
    pending = {}
    for key in sorted(keys):
        names = planned.get(key, [])
        ready = tuple(s for s in names if s in state)
        if ready:
            groups[ready].add(key)
        if len(ready) != len(names):
            pending[f"{key[1]}_{key[2]}"] = [s for s in names if s not in state]
    old_paths = bundles(root, previous) + [PILOT / (n + ".faces") for n in SEEDS]
    old = FaceLibrary(old_paths)
    faces = FaceLibrary([*old_paths, *bundles(root, new)])
    records = {}
    donors = {}
    from hashlib import sha256

    for names, wanted in groups.items():
        paths = [CITY / "packs" / (s + ".bay") for s in names]
        for s, p in zip(names, paths):
            if s not in donors:
                donors[s] = digest(p)
                if donors[s] != state[s]["packs/" + p.name]:
                    raise ValueError("source square changed")
        with TemporaryDirectory(dir=root) as temp:
            tiles.PACKS = temp
            tiles.cut(paths, wanted)
            for _, x, z in wanted:
                name = f"{x}_{z}"
                p = Path(temp) / "tiles/0" / (name + ".bay")
                base = p.read_bytes()
                before = apply(base, old)
                after = apply(base, faces)
                if before != after:
                    records[name] = dict(
                        base=sha256(base).hexdigest(),
                        previous=sha256(before).hexdigest(),
                        sha256=sha256(after).hexdigest(),
                        bytes=len(after),
                        contributors=list(names),
                    )
    return dict(squares=donors, tiles=records, pendingNeighbours=pending)
