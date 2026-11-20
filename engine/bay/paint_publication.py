"""When the city finishes cutting tiles, stage it locally with the most recent accepted batch."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from city_paint import CITY, HERE, ROOT
from full_run import digest, plan, save


def stage():
    index = CITY / "packs/tiles/index.json"
    pointer = ROOT / "current.json"
    if (
        not index.exists()
        or not pointer.exists()
        or shutil.disk_usage(ROOT).free < 18 * 2**30
    ):
        return
    state = json.loads((CITY / "state.json").read_text())["done"]
    coverage = json.loads((HERE / "sf-squares.json").read_text())
    listing = json.loads(index.read_text())
    squares = listing["squares"]
    if squares != coverage["lidar"] or any(s not in state for s in squares):
        return
    # The frozen city runner writes the index atomically once all its tile groups finish.
    planned = set(plan(squares, coverage["planet"], True))
    listed = {
        (l, x, z)
        for kind in ("tiles", "sea")
        for l, rows in enumerate(listing[kind])
        for x, z in rows
    }
    if listed != planned:
        raise ValueError("city index is incomplete")
    graph_state = ROOT / "transport/checkpoints.json"
    if not graph_state.is_file():
        return
    graphs = json.loads(graph_state.read_text())
    if not set(squares) <= graphs.keys():
        return
    batch = json.loads(pointer.read_text())["batch"]
    sources = {s: graphs[s]["graph"] for s in squares}
    far = ROOT.parent.parent / "sf/far/release/far.json"
    stamp = dict(
        index=digest(index),
        batch=batch,
        graphs=sources,
        far=digest(far) if far.is_file() else None,
    )
    record = ROOT / "city-release.json"
    if record.is_file() and json.loads(record.read_text())["inputs"] == stamp:
        return
    sf = HERE.parent / "sf"
    with TemporaryDirectory(dir=ROOT) as temp:
        tmp = Path(temp)
        (tmp / "graph").mkdir()
        for s, sha in sources.items():
            source = ROOT / "graph" / (s + ".json")
            if digest(source) != sha:
                raise ValueError("graph changed before city release")
            target = tmp / "graph" / source.name
            shutil.copyfile(source, target)
            if digest(target) != sha:
                raise ValueError("graph changed while copying")
        subprocess.run(
            [
                sys.executable,
                sf / "life.py",
                "--graphs",
                tmp / "graph",
                "--inputs",
                CITY / "inputs",
                "--out",
                tmp / "life",
            ],
            check=True,
        )
        subprocess.run(["node", sf / "cars.mjs", tmp / "cars"], check=True)
        sys.path.insert(0, str(sf))
        from release import generate

        pin = generate(
            CITY,
            ROOT / "sf",
            graph_dir=tmp / "graph",
            far_index=far if far.is_file() else None,
            life=tmp / "life",
            cars=tmp / "cars",
            compact_store=CITY / "objects",
            paint=ROOT / "accepted" / (batch + ".json"),
        )
        save(record, dict(inputs=stamp, release=pin))
        print(
            "complete city candidate staged for the full-release panel", pin, flush=True
        )


if __name__ == "__main__":
    stage()
