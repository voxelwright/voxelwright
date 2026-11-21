"""Survey finished city squares in weak-street order. Immutable face bundles await panel acceptance."""

import argparse
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from concurrent.futures.process import BrokenProcessPool
import fcntl
from functools import lru_cache
import json
import math
from pathlib import Path
import shutil
import time

from coverage import bounds
from facade_paint import edges, load_faces, project, write_faces
from full_run import BAY, digest, save
from paint_cameras import RESERVE, Requests, select
from tiles import read

HERE = Path(__file__).parent
CITY = BAY / "sf-450-city"
ROOT = BAY / "450-city-paint"
PILOT = BAY / "450-paint"
PANEL = json.loads((HERE / "neighbourhoods.json").read_text())
SEEDS = ("Financial District", "Dogpatch", "North Beach", "Chinatown")
# A wall belongs to the 1/7 km cell containing its midpoint, including edges repeated by adjacent squares.
DIV = 7
# Reach the corners of the owned cell, including a small camera-location tolerance.
RADIUS = math.ceil(1000 / DIV / math.sqrt(2)) + 3
# Acquisition waits on the network: projection measured under 1 s of CPU per window.
WORKERS = 8
IMAGE_CACHE = 512 * 2**20
# An image touched this recently may belong to a window still in flight.
IN_USE = 180


def window(square, key):
    x, z, _, _ = bounds(square)
    a, b, c, d = key
    return (
        math.floor(((a + c) / 20 - x) * DIV / 1000),
        math.floor(((b + d) / 20 - z) * DIV / 1000),
    )


def inventory(square, pack, graph, scores, poses):
    x, z, _, _ = bounds(square)
    eligible = set()
    for vertices, _ in read(pack)["buildings"]:
        for _, key, flags in edges(vertices):
            i, j = window(square, key)
            if flags & 1 and 0 <= i < DIV and 0 <= j < DIV:
                eligible.add((i, j))
    roads = json.loads(graph.read_text())["roads"]
    sites = []
    for i, j in sorted(eligible):
        cx, cz = x + (i + 0.5) * 1000 / DIV, z + (j + 0.5) * 1000 / DIV
        place = min(
            poses,
            key=lambda name: math.hypot(
                cx - poses[name]["street"][0], cz - poses[name]["street"][2]
            ),
        )
        pose = poses[place]["street"]
        distance = math.hypot(cx - pose[0], cz - pose[2])
        # A measured score applies to the surveyed street. Other blocks follow the nearest sample.
        rank = [
            0 if distance < 160 else 1,
            scores[place][0],
            round(distance),
            square,
            i,
            j,
        ]
        yaw = pose[3]
        if roads:
            road = min(roads, key=lambda r: math.dist([cx * 10, cz * 10], r["line"][0]))
            a, b = road["line"][0:2]
            yaw = math.degrees(math.atan2(b[0] - a[0], a[1] - b[1]))
        sites.append(
            dict(
                id=f"{square}-{i}-{j}",
                centre=[cx, cz],
                yaw=yaw,
                cell=[i, j],
                square=square,
                nearest=place,
                rank=rank,
            )
        )
    return sites


@lru_cache(maxsize=1)
def seed_faces():
    seed = load_faces([PILOT / (place + ".faces") for place in SEEDS])
    seed.update({(c, d, a, b): v for (a, b, c, d), v in list(seed.items())})
    return seed


def paint_window(root, site, stamp):
    """Acquire and project one window in a pool process. Only a finished window writes its record."""
    cache = root / "cache"
    objects = cache / "objects"
    square, ident = site["square"], site["id"]
    pack = CITY / "packs" / (square + ".bay")
    req = Requests(cache, 160)
    start = time.time()
    photos = list(
        select(
            ident,
            site["centre"],
            site["yaw"],
            square,
            {r["image"] for r in PANEL},
            cache,
            req,
            12,
            objects,
            RADIUS,
        )
    )
    catalog = cache / ident / "cameras.json"
    save(catalog, photos)
    faces, _ = (
        project(pack, catalog, site["centre"], objects, RADIUS) if photos else ({}, {})
    )
    seed = seed_faces()
    kept = {
        k: v
        for k, v in faces.items()
        if window(square, k) == tuple(site["cell"]) and k not in seed
    }
    bundle = root / "faces" / (ident + ".faces")
    write_faces(bundle, kept)
    record = dict(
        **site,
        pack=stamp,
        faceSha256=digest(bundle),
        cameraSha256=digest(catalog),
        cameraIds=[p["id"] for p in photos],
        source="Mapillary",
        walls=len(kept),
        texels=sum(int((v[1] != 0).sum()) for v in kept.values()),
        api=req.api,
        requests=req.count,
        bytes=req.bytes,
        seconds=round(time.time() - start, 2),
    )
    save(root / "windows" / (ident + ".json"), record)
    return f"{ident} {site['nearest']} {len(photos)} cameras {len(kept)} walls {req.count} requests"


def windows_queue(root, scores, evidence, done):
    state = json.loads((CITY / "state.json").read_text())["done"]
    queue = []
    for square in sorted(k for k in state if k[0].isdigit()):
        pack = CITY / "packs" / (square + ".bay")
        graph = CITY / "packs/graph" / (square + ".json")
        stamp = state[square][str(pack.relative_to(CITY))]
        gp = state["streets-" + square][str(graph.relative_to(CITY))]
        index = root / "inventory" / (square + ".json")
        current = json.loads(index.read_text()) if index.exists() else {}
        if current.get("source") != [stamp, gp]:
            if digest(pack) != stamp or digest(graph) != gp:
                raise ValueError("square changed after city verification")
            current = dict(
                source=[stamp, gp],
                sites=inventory(square, pack, graph, scores, evidence["poses"]),
            )
            save(index, current)
        for site in current["sites"]:
            if site["id"] in done:
                if done[site["id"]] != stamp:
                    raise ValueError("paint input changed after survey")
            else:
                site["rank"][1] = scores[site["nearest"]][0]
                queue.append((site["rank"], site, stamp))
    return sorted(queue, key=lambda row: row[0])


def prune(objects):
    # Face bundles are the wall records and the gate replays from them. Images are only
    # projection input: keep a bounded recent cache for neighbouring windows.
    now = time.time()
    files = sorted(
        (s.st_mtime, s.st_size, p)
        for p in objects.glob("*.jpg")
        for s in [p.stat()]
    )
    size = sum(f[1] for f in files)
    for mtime, length, path in files:
        if size <= IMAGE_CACHE or mtime > now - IN_USE:
            break
        path.unlink(missing_ok=True)
        size -= length


def survey(root, once=False, workers=WORKERS):
    cache = root / "cache"
    objects = cache / "objects"
    for path in (objects, root / "windows", root / "inventory", root / "faces"):
        path.mkdir(parents=True, exist_ok=True)
    baseline = json.loads((PILOT / "final-scores.json").read_text())
    evidence = json.loads((PILOT / "evidence.json").read_text())
    # Share cached solves from the four pilot surveys. The first requester may then use the same
    # camera as a neighbour without another Graph call or an expiring thumbnail URL.
    for name in SEEDS if not (cache / "seeded.json").exists() else []:
        for src in (PILOT / "cameras" / name).glob("*"):
            if (
                src.stem.isdigit()
                and src.suffix in (".jpg", ".json")
                and not (objects / src.name).exists()
            ):
                shutil.copyfile(src, objects / src.name)
    save(cache / "seeded.json", list(SEEDS))
    done = {
        p.stem: json.loads(p.read_text())["pack"]
        for p in (root / "windows").glob("*.json")
    }
    flight, retry, queue, epoch = {}, {}, [], None
    pool = ProcessPoolExecutor(workers)
    try:
        while True:
            for future in [f for f in flight if f.done()]:
                ident, stamp = flight.pop(future)
                try:
                    print(future.result(), flush=True)
                    done[ident] = stamp
                except Exception as e:
                    # No record was written. The window returns to the queue after a pause.
                    print(ident, "failed:", type(e).__name__, e, flush=True)
                    retry[ident] = time.time() + 120
                    if isinstance(e, BrokenProcessPool):
                        pool.shutdown(cancel_futures=True)
                        pool = ProcessPoolExecutor(workers)
                if once:
                    return
            prune(objects)
            if (root / "hold-at-boundary").exists():
                if not flight:
                    print("holding at completed window boundary", flush=True)
                    return
                wait(flight, timeout=5, return_when=FIRST_COMPLETED)
                continue
            if shutil.disk_usage(root).free < RESERVE:
                print(f"waiting for {RESERVE / 2**30:g} GiB free", flush=True)
                if once and not flight:
                    return
                wait(flight, timeout=300, return_when=FIRST_COMPLETED) if flight else time.sleep(300)
                continue
            pin = (
                json.loads((root / "current.json").read_text())["batch"]
                if (root / "current.json").exists()
                else None
            )
            key = (pin, (CITY / "state.json").stat().st_mtime_ns)
            if key != epoch or not queue:
                scores = (
                    json.loads((root / "accepted" / (pin + ".json")).read_text())["scores"]
                    if pin
                    else baseline
                )
                queue, epoch = windows_queue(root, scores, evidence, done), key
            busy = set(v[0] for v in flight.values())
            now = time.time()
            queue = [row for row in queue if row[1]["id"] not in done]
            for _, site, stamp in queue:
                if len(flight) >= (1 if once else workers):
                    break
                if site["id"] in busy or retry.get(site["id"], 0) > now:
                    continue
                flight[pool.submit(paint_window, root, site, stamp)] = (site["id"], stamp)
                busy.add(site["id"])
            if not flight:
                print("waiting for new completed squares", flush=True)
                if once:
                    return
                time.sleep(180)
                continue
            wait(flight, timeout=5, return_when=FIRST_COMPLETED)
    finally:
        pool.shutdown(cancel_futures=True)


def status(root):
    records = [
        json.loads(p.read_text()) for p in sorted((root / "windows").glob("*.json"))
    ]
    indices = [json.loads(p.read_text()) for p in (root / "inventory").glob("*.json")]
    allowance = root / "cache/allowance.json"
    rate = json.loads(allowance.read_text()) if allowance.exists() else {}
    now = time.time()
    minute = int(now // 60)
    minutes = {int(k): v for k, v in rate.get("minutes", {}).items()}
    finished = [p.stat().st_mtime for p in (root / "windows").glob("*.json")]
    hourly = sum(t > now - 3600 for t in finished)
    remaining = sum(len(i["sites"]) for i in indices) - len(records)
    pending = root / "pending/evidence.json"
    print(
        json.dumps(
            dict(
                readySquares=len(indices),
                readyWindows=sum(len(i["sites"]) for i in indices),
                surveyed=len(records),
                walls=sum(r["walls"] for r in records),
                texels=sum(r["texels"] for r in records),
                thinWindows=sum(len(r["cameraIds"]) < 5 for r in records),
                distinctCameras=len({i for r in records for i in r["cameraIds"]}),
                requests=rate.get("total", 0),
                api=rate.get("api", 0),
                requestsLastMinute=minutes.get(minute - 1, 0),
                requestsLastHour=sum(v for k, v in minutes.items() if k >= minute - 60),
                tilesLastDay=len(rate.get("tiles", [])),
                windowsLastHour=hourly,
                projectedFinishUTC=time.strftime(
                    "%Y-%m-%d %H:%M UTC", time.gmtime(now + remaining / hourly * 3600)
                )
                if hourly
                else None,
                nextAllowedUTC=time.strftime(
                    "%Y-%m-%d %H:%M:%S UTC", time.gmtime(rate.get("next", 0))
                ),
                lastCooldown=rate.get("lastCooldown"),
                lastAppUsage=rate.get("lastAppUsage"),
                awaitingReview=json.loads(pending.read_text())["batch"]
                if pending.exists()
                else None,
                acceptanceHeld=(root / "hold-acceptance").exists(),
                batches=len(list((root / "accepted").glob("*.json"))),
                freeGiB=round(shutil.disk_usage(root).free / 2**30, 1),
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=["worker", "once", "status"])
    cli.add_argument("--root", type=Path, default=ROOT)
    cli.add_argument("--workers", type=int, default=WORKERS)
    args = cli.parse_args()
    args.root.mkdir(exist_ok=True, parents=True)
    if args.action == "status":
        status(args.root)
    else:
        cache = args.root / "cache"
        cache.mkdir(exist_ok=True)
        with (cache / ".acquire.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            survey(args.root, args.action == "once", args.workers)
