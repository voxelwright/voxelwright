"""Stage one immutable paint batch. Carry a grade only across identical panel inputs or identical pixels."""

import argparse
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess

from city_paint import BAY, CITY, HERE, PANEL, PILOT, ROOT, SEEDS
from facade_paint import FaceLibrary
from full_run import digest, save
from neighbourhood_panel import stage
from paint_tile import apply
from panel_gate import check, gate

ENGINE = HERE.parent
POSES = BAY / "450-panel/fixed-poses.json"
REFS = BAY / "450-panel/references"


def fingerprint(obj):
    return sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def load(path):
    return json.loads(path.read_text())


def renderer():
    files = [
        ENGINE / "page/core.wasm",
        ENGINE / "serve.mjs",
        HERE / "shot.mjs",
        POSES,
        HERE / "neighbourhoods.json",
        *sorted((ENGINE / "page").rglob("*.ts")),
    ]
    return fingerprint([digest(p) for p in files])


def bundles(root, members):
    paths = []
    for ident, expected in members.items():
        path = root / "faces" / (ident + ".faces")
        if digest(path) != expected:
            raise ValueError(f"face bundle differs: {ident}")
        paths.append(path)
    return paths


def accepted_faces(receipt):
    root = receipt.parent.parent
    data = load(receipt)
    batch = data.pop("batch")
    scores = data.pop("scores")
    data.pop("cityTiles", None)
    floors = data.pop("floors", None)
    for key in ("inspection", "scoresCarried"):
        data.pop(key, None)
    if (
        receipt.parent.name != "accepted"
        or receipt.stem != batch
        or fingerprint(data) != batch
    ):
        raise ValueError("unverified paint batch")
    previous = (
        load(root / "accepted" / (data["previous"] + ".json"))["scores"]
        if data["previous"]
        else load(PILOT / "final-scores.json")
    )
    check(scores, previous, None if floors is None else {tuple(f) for f in floors})
    paths = bundles(root, data["members"])
    for place, sha in data["seeds"].items():
        path = PILOT / (place + ".faces")
        if digest(path) != sha:
            raise ValueError("seed bundle changed")
        paths.append(path)
    return FaceLibrary(paths)


def shot(group, places, dest, inputs=None):
    # The server chooses an available loopback port. shot.mjs uses kit.chrome() / turn().
    env = {**os.environ, "VILLAGE_BAY_ROOT": str(group)}
    with subprocess.Popen(
        ["node", "serve.mjs", "--port", "0", "--reports", "/dev/null"],
        cwd=ENGINE,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    ) as srv:
        try:
            import re

            for line in srv.stdout:
                match = re.search(r"engine page on (http://127.0.0.1:\d+)", line)
                if match:
                    break
            else:
                raise RuntimeError("panel server failed to start")
            poses = load(POSES)
            for r in places:
                place = r["place"]
                checkpoint = dest / (place + ".pair.json")
                pair = [dest / f"{place}-{i}.png" for i in range(2)]
                if inputs and checkpoint.is_file() and all(p.is_file() for p in pair):
                    if load(checkpoint) == dict(
                        inputs=inputs, shots=[digest(p) for p in pair]
                    ):
                        continue
                args = ";".join(
                    ",".join(map(str, poses[place][k])) for k in ("street", "100 m")
                )
                name = f"450-citypaint-{os.getpid()}-" + place.replace(" ", "")
                result = subprocess.run(
                    [
                        "node",
                        "bay/shot.mjs",
                        "--square",
                        r["square"],
                        "--name",
                        name,
                        "--views",
                        args,
                        "--server",
                        match[1],
                        "--size",
                        "960x540",
                        "--wait",
                        "800",
                    ],
                    capture_output=True,
                    text=True,
                    cwd=ENGINE,
                    env=env,
                    # The shared GPU queue may wait indefinitely. Playwright bounds the browser operations.
                )
                if (
                    result.returncode
                    or "page error:" in result.stdout
                    or "not all made" in result.stdout
                ):
                    raise RuntimeError(
                        f"incomplete GPU pair: {place} {result.stdout[-300:]}"
                    )
                for i, target in enumerate(pair):
                    src = BAY / "shots" / f"{name}-{i}.png"
                    temp = target.with_suffix(".part")
                    shutil.copyfile(src, temp)
                    temp.replace(target)
                    src.unlink()
                if inputs:
                    save(
                        checkpoint, dict(inputs=inputs, shots=[digest(p) for p in pair])
                    )
                print("captured", place, flush=True)
        finally:
            srv.terminate()


def stage_batch(root):
    prior = load(root / "current.json") if (root / "current.json").exists() else {}
    original = load(PILOT / "evidence.json")
    prev = load(root / "accepted" / (prior["batch"] + ".json")) if prior else {}
    members = dict(prev.get("members", {}))
    # Freeze the work list before rendering so acquisitions can continue independently.
    work = root / "pending"
    work.mkdir(exist_ok=True)
    spec = work / "batch.json"
    if not spec.exists():
        rows = sorted(
            (load(p) for p in (root / "windows").glob("*.json")),
            key=lambda r: r["rank"],
        )
        new = [r for r in rows if r["id"] not in members][:32]
        if not new:
            return
        members.update({r["id"]: r["faceSha256"] for r in new})
        save(
            spec,
            dict(
                previous=prior.get("batch"),
                members=members,
                renderer=renderer(),
                seeds={n: digest(PILOT / (n + ".faces")) for n in SEEDS},
            ),
        )
    batch = load(spec)
    if batch["previous"] != prior.get("batch") or batch["renderer"] != renderer():
        raise ValueError("staged batch has a different predecessor or renderer")
    if (work / "evidence.json").exists():
        return
    faces = FaceLibrary(bundles(root, batch["members"]))
    views = {}
    hashes = {}
    for group, inventory in original["tileFiles"].items():
        if shutil.disk_usage(root).free < 17 * 2**30:
            raise RuntimeError("holding panel for disk")
        base = (
            PILOT / group
            if group.startswith("final/")
            else root / "controls" / Path(group).name
        )
        if not (base / "packs/tiles/index.json").exists():
            stage(CITY, base, {Path(group).name})
        dest = work / group
        packs = dest / "packs"
        packs.mkdir(parents=True, exist_ok=True)
        for p in (base / "packs").iterdir():
            if p.is_file() and not (packs / p.name).exists():
                (packs / p.name).symlink_to(p)
        hashes[group] = {}
        for rel, expected in inventory.items():
            src = base / "packs/tiles" / rel
            if digest(src) != expected:
                raise ValueError(f"baseline tile differs: {group}/{rel}")
            out = packs / "tiles" / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            data = src.read_bytes()
            changed = apply(data, faces) if rel.endswith(".bay") else data
            h = sha256(changed).hexdigest()
            hashes[group][rel] = h
            if out.is_symlink():
                out.unlink()
            if h == expected:
                if out.exists():
                    out.unlink()
                out.symlink_to(src)
            elif not out.exists() or digest(out) != h:
                out.write_bytes(changed)
        places = [r for r in PANEL if original["views"][r["place"]]["group"] == group]
        same = prev.get("renderer") == batch["renderer"] and hashes[group] == prev.get(
            "tileFiles", {}
        ).get(group)
        shots = work / "shots"
        shots.mkdir(exist_ok=True)
        if not same:
            shot(
                dest,
                places,
                shots,
                fingerprint([group, batch["renderer"], hashes[group]]),
            )
        for r in places:
            p = r["place"]
            refs = [digest(REFS / (p + suffix + ".jpg")) for suffix in ("", " 100 m")]
            if refs != original["views"][p]["reference"]:
                raise ValueError("panel reference changed")
            views[p] = (
                prev["views"][p]
                if same
                else [digest(shots / f"{p}-{i}.png") for i in range(2)]
            )
        print("verified group", group, flush=True)
    result = dict(
        **batch,
        views=views,
        tileFiles=hashes,
        references={k: v["reference"] for k, v in original["views"].items()},
    )
    result["batch"] = fingerprint(result)
    save(work / "evidence.json", result)
    old_views = prev.get("views", {k: v["after"] for k, v in original["views"].items()})
    if old_views == views:
        accept(root, result["batch"], None)
    else:
        print("awaiting review", result["batch"], flush=True)


def shot_file(root, place, i, sha):
    """A view's render: this batch's new shot, or the accepted one it carries, kept in an earlier proof."""
    for path in [root / "pending/shots" / f"{place}-{i}.png", *sorted((root / "proof").glob(f"*/shots/{place}-{i}.png"))]:
        if path.is_file() and digest(path) == sha:
            return path
    raise ValueError(f"no render with the recorded bytes: {place} {i}")


def accept(root, candidate, scores=None):
    """Scores are optional: without them the previous ones are carried, flagged, and hold no floor."""
    work = root / "pending"
    e = load(work / "evidence.json")
    if e.pop("batch") != candidate or fingerprint(e) != candidate:
        raise ValueError("different panel evidence")
    prior = (
        load(root / "current.json")["batch"]
        if (root / "current.json").exists()
        else None
    )
    if e["previous"] != prior or e["renderer"] != renderer():
        raise ValueError("stale batch")
    prior_receipt = load(root / "accepted" / (prior + ".json")) if prior else {}
    previous = prior_receipt.get("scores") or load(PILOT / "final-scores.json")
    previous_views = (
        load(root / "accepted" / (prior + ".json"))["views"] if prior else {}
    )
    if set(e["views"]) != set(scores if scores is not None else previous):
        raise ValueError("missing fixed-camera evidence")
    for group, inventory in e["tileFiles"].items():
        for rel, sha in inventory.items():
            if digest(work / group / "packs/tiles" / rel) != sha:
                raise ValueError("graded tile changed")
    for place, hashes in e["views"].items():
        if len(hashes) != 2:
            raise ValueError("both panel heights are required")
        for i, h in enumerate(hashes):
            p = work / "shots" / f"{place}-{i}.png"
            if p.exists():
                if digest(p) != h:
                    raise ValueError("candidate shot changed")
            elif previous_views.get(place) != hashes:
                raise ValueError("missing new camera pair")
    # Every view's pixels, carried or new, before any score: a floor only where the earlier render passed them.
    report = gate(
        {p: [shot_file(root, p, i, h) for i, h in enumerate(pair)] for p, pair in e["views"].items()},
        root / "inspections",
    )
    judged = set()
    if not prior_receipt.get("scoresCarried"):
        for place, pair in prior_receipt.get("inspection", {}).items():
            judged.update((place, i) for i, passed in enumerate(pair) if passed)
    carried = scores is None
    if carried:
        scores = previous
    else:
        check(scores, previous, judged)
    bundles(root, e["members"])
    from paint_batch_tiles import measure

    previous_members = (
        load(root / "accepted" / (prior + ".json"))["members"] if prior else {}
    )
    city_tiles = measure(root, e["members"], previous_members)
    accepted = root / "accepted"
    accepted.mkdir(exist_ok=True)
    save(
        accepted / (candidate + ".json"),
        dict(
            **e,
            batch=candidate,
            scores=scores,
            scoresCarried=carried,
            floors=[] if carried else sorted(judged),
            inspection={p: [r["passed"] for r in pair] for p, pair in report.items()},
            cityTiles=city_tiles,
        ),
    )
    save(root / "current.json", dict(batch=candidate))
    finish(root, candidate)


def finish(root, candidate):
    work = root / "pending"
    dest = root / "proof" / candidate
    dest.mkdir(parents=True, exist_ok=True)
    if (work / "shots").exists():
        (work / "shots").rename(dest / "shots")
    shutil.rmtree(work)
    # Keep the first panel and the latest accepted image at every pose. Older receipts retain
    # their shot hashes, while obsolete full-resolution comparisons share a bounded cache.
    receipt = load(root / "accepted" / (candidate + ".json"))
    current = {h for pair in receipt["views"].values() for h in pair}
    archives = sorted(
        (root / "proof").glob("*/shots/*.png"), key=lambda p: p.stat().st_mtime
    )
    size = sum(p.stat().st_size for p in archives)
    if size > 384 * 2**20:
        first = {
            p.stem
            for p in (root / "accepted").glob("*.json")
            if load(p)["previous"] is None
        }
        for p in archives:
            if size <= 384 * 2**20:
                break
            if p.parents[1].name not in first and digest(p) not in current:
                size -= p.stat().st_size
                p.unlink()


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=["stage", "accept"])
    cli.add_argument("--batch")
    cli.add_argument("--scores", type=Path, help="the building lane's scores, if any")
    args = cli.parse_args()
    with (ROOT / "panel.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == "stage":
            receipt = ROOT / "pending/evidence.json"
            if (
                receipt.exists()
                and (ROOT / "current.json").exists()
                and load(receipt)["batch"] == load(ROOT / "current.json")["batch"]
            ):
                finish(ROOT, load(receipt)["batch"])
            stage_batch(ROOT)
        else:
            accept(ROOT, args.batch, load(args.scores) if args.scores else None)
