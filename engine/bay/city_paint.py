"""Survey finished city squares in weak-street order. Immutable face bundles await panel acceptance."""

import argparse
from collections import defaultdict
import fcntl
import json
import math
from pathlib import Path
import shutil
import time

from coverage import bounds
from facade_paint import edges, load_faces, project, write_faces
from full_run import BAY, digest, save
from paint_cameras import Requests, select
from tiles import read

HERE = Path(__file__).parent
CITY = BAY / "sf-450-city"
ROOT = BAY / "450-city-paint"
PILOT = BAY / "450-paint"
PANEL = json.loads((HERE / "neighbourhoods.json").read_text())
SEEDS = ("Financial District", "Dogpatch", "North Beach", "Chinatown")
# A wall belongs to the 1/7 km cell containing its midpoint, including edges repeated by adjacent squares.
DIV = 7


def window(square, key):
    x, z, _, _ = bounds(square)
    a, b, c, d = key
    return (math.floor(((a+c)/20-x)*DIV/1000), math.floor(((b+d)/20-z)*DIV/1000))


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
        cx, cz = x+(i+.5)*1000/DIV, z+(j+.5)*1000/DIV
        place = min(poses, key=lambda name: math.hypot(cx-poses[name]["street"][0], cz-poses[name]["street"][2]))
        pose = poses[place]["street"]
        distance = math.hypot(cx-pose[0], cz-pose[2])
        # A measured score applies to the surveyed street. Other blocks follow the nearest sample.
        rank = [0 if distance < 160 else 1, scores[place][0], round(distance), square, i, j]
        yaw = pose[3]
        if roads:
            road = min(roads, key=lambda r: math.dist([cx*10, cz*10], r["line"][0]))
            a, b = road["line"][0:2]
            yaw = math.degrees(math.atan2(b[0]-a[0], a[1]-b[1]))
        sites.append(dict(id=f"{square}-{i}-{j}", centre=[cx, cz], yaw=yaw, cell=[i,j], square=square, nearest=place, rank=rank))
    return sites


def survey(root, once=False):
    cache = root / "cache"
    objects = cache / "objects"
    for path in (objects, root/"windows", root/"inventory", root/"faces"):
        path.mkdir(parents=True, exist_ok=True)
    scores = json.loads((PILOT/"final-scores.json").read_text())
    evidence = json.loads((PILOT/"evidence.json").read_text())
    seed = load_faces([PILOT/(place+".faces") for place in SEEDS])
    while True:
        if shutil.disk_usage(root).free < 17*2**30:
            print("waiting for 17 GiB free", flush=True)
            if once: return
            time.sleep(300)
            continue
        state = json.loads((CITY/"state.json").read_text())["done"]
        queue = []
        for square in sorted(k for k in state if k[0].isdigit()):
            pack = CITY/"packs"/(square+".bay")
            graph = CITY/"packs/graph"/(square+".json")
            stamp = state[square][str(pack.relative_to(CITY))]
            gp = state["streets-"+square][str(graph.relative_to(CITY))]
            index = root/"inventory"/(square+".json")
            current = json.loads(index.read_text()) if index.exists() else {}
            if current.get("source") != [stamp,gp]:
                if digest(pack) != stamp or digest(graph) != gp:
                    raise ValueError("square changed after city verification")
                current = dict(source=[stamp,gp], sites=inventory(square,pack,graph,scores,evidence["poses"]))
                save(index,current)
            for site in current["sites"]:
                done = root/"windows"/(site["id"]+".json")
                if done.exists():
                    record = json.loads(done.read_text())
                    if record["pack"] != stamp:
                        raise ValueError("paint input changed after survey")
                else:
                    queue.append((site["rank"], site, stamp))
        if not queue:
            print("waiting for new completed squares", flush=True)
            if once: return
            time.sleep(180)
            continue
        _, site, stamp = min(queue, key=lambda row: row[0])
        square, ident = site["square"], site["id"]
        folder = cache/ident
        pack = CITY/"packs"/(square+".bay")
        req = Requests(cache, 160)
        start = time.time()
        photos = list(select(ident,site["centre"],site["yaw"],square,{r["image"] for r in PANEL},cache,req,12,objects))
        catalog = folder/"cameras.json"
        save(catalog, photos)
        faces, stats = project(pack,catalog,site["centre"],objects) if photos else ({}, {})
        kept = {k:v for k,v in faces.items() if window(square,k)==tuple(site["cell"]) and k not in seed}
        bundle = root/"faces"/(ident+".faces")
        write_faces(bundle,kept)
        record = dict(**site, pack=stamp, faceSha256=digest(bundle), cameraSha256=digest(catalog), cameraIds=[p["id"] for p in photos],
                      source="Mapillary", walls=len(kept), texels=sum(int((v[1]!=0).sum()) for v in kept.values()),
                      api=req.api, requests=req.count, bytes=req.bytes, seconds=round(time.time()-start,2))
        save(root/"windows"/(ident+".json"),record)
        print(ident,site["nearest"],len(photos),"cameras",len(kept),"walls",req.count,"requests",flush=True)
        # Bound full resolution while preserving all positive/negative camera solves and completed bundles.
        files = sorted(objects.glob("*.jpg"), key=lambda p:p.stat().st_mtime)
        size = sum(p.stat().st_size for p in files)
        for path in files:
            if size <= 384*2**20: break
            size -= path.stat().st_size
            path.unlink()
        if once: return


def status(root):
    records = [json.loads(p.read_text()) for p in sorted((root/"windows").glob("*.json"))]
    indices = [json.loads(p.read_text()) for p in (root/"inventory").glob("*.json")]
    allowance = root/"cache/allowance.json"
    rate = json.loads(allowance.read_text()) if allowance.exists() else {}
    print(json.dumps(dict(readySquares=len(indices), readyWindows=sum(len(i["sites"]) for i in indices),
                          surveyed=len(records), walls=sum(r["walls"] for r in records), texels=sum(r["texels"] for r in records),
                          distinctCameras=len({i for r in records for i in r["cameraIds"]}),
                          requests=rate.get("total",0), api=rate.get("api",0), nextRequest=rate.get("next"),
                          batches=len(list((root/"accepted").glob("*.json"))), freeGiB=round(shutil.disk_usage(root).free/2**30,1)),indent=2))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=["worker","once","status"])
    cli.add_argument("--root", type=Path, default=ROOT)
    args = cli.parse_args()
    args.root.mkdir(exist_ok=True,parents=True)
    if args.action=="status":
        status(args.root)
    else:
        with (args.root/"worker.lock").open("a") as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            survey(args.root,args.action=="once")
