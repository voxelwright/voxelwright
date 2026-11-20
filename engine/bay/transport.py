"""Add surveyed road levels and traffic controls to city graphs without rewriting a verified bake."""

import argparse
import fcntl
import gzip
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from coverage import bounds
from street_graph import cells
from full_run import PILOT, save, digest

ROAD_TAGS = ("tunnel", "bridge", "layer", "highway")
BOX = "37.68,-122.54,37.85,-122.34"


def snapshot(cache):
    dest = cache / "city-controls.json.gz"
    if dest.exists():
        return dest
    cache.mkdir(parents=True, exist_ok=True)
    q = f'[out:json][timeout:90][bbox:{BOX}];(way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"];node[highway~"^(stop|traffic_signals)$"];);out tags;'
    req = Request(
        "https://overpass-api.de/api/interpreter",
        data=urlencode({"data": q}).encode(),
        headers={"User-Agent": "Village-SF-data"},
    )
    with urlopen(req, timeout=120) as reply:
        data = json.load(reply)
    if data.get("remark") or not data.get("elements"):
        raise ValueError("incomplete OSM inventory")
    ways, controls = {}, {}
    for e in data["elements"]:
        t = e.get("tags", {})
        if e["type"] == "way":
            ways[e["id"]] = {k: t[k] for k in ROAD_TAGS if k in t}
        else:
            controls[e["id"]] = {
                k: t[k]
                for k in ("highway", "stop", "direction", "traffic_signals:direction")
                if k in t
            }
    survey = {}
    for key, dataset, fields in (
        ("stopSigns", "4542-gpa3", "objectid,shape,cnn,st_facing,status"),
        ("signals", "ybh5-27n2", "objectid,shape,cnn,sig_num"),
    ):
        params = {"$select": fields, "$limit": 50000, "$order": "objectid"}
        with urlopen(
            "https://data.sf.gov/resource/" + dataset + ".json?" + urlencode(params),
            timeout=90,
        ) as response:
            rows = json.load(response)
        if not 0 < len(rows) < 50000:
            raise ValueError("incomplete municipal survey")
        survey[key] = [
            dict(
                id=r["objectid"],
                point=cells(*r["shape"]["coordinates"]),
                **{k: v for k, v in r.items() if k not in ("shape", "objectid")},
            )
            for r in rows
            if r.get("shape")
        ]
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(
        gzip.compress(
            json.dumps(
                dict(ways=ways, controls=controls, **survey), separators=(",", ":")
            ).encode(),
            mtime=0,
        )
    )
    tmp.replace(dest)
    return dest


def enrich(data, obs, photos, city):
    x, z, e, s = (v * 10 for v in bounds(data["square"]))

    def inside(p):
        return x <= p[0] < e and z <= p[1] < s

    for r in data["roads"]:
        way = r["id"].split("/")[0]
        tags = city["ways"].get(way)
        r["highway"] = obs["ways"][way]["tags"]["highway"]
        for k in ("tunnel", "bridge", "layer"):
            r[k] = (
                tags.get(k, "0" if k == "layer" else "no") if tags is not None else None
            )
    controls = []
    for ident, node in obs["nodes"].items():
        tags = city["controls"].get(ident, {})
        kind = tags.get("highway", node[2])
        if kind not in ("stop", "traffic_signals"):
            continue
        p = cells(*node[:2])
        if inside(p):
            controls.append(
                dict(
                    node=int(ident),
                    point=p,
                    kind=kind,
                    allWay=tags.get("stop") == "all" if tags.get("stop") else None,
                    direction=tags.get(
                        "direction", tags.get("traffic_signals:direction")
                    ),
                )
            )
    data["controls"] = controls
    for k in ("stopSigns", "signals"):
        data[k] = [r for r in city[k] if inside(r["point"])]
    data["photoStopSigns"] = [p for p in photos["points"] if inside(p)]
    return data


def build(root, dest, names):
    cache = dest.parent / "transport"
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / "build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        build_locked(root, dest, names)


def build_locked(root, dest, names):
    snap = snapshot(dest.parent / "transport")
    city = json.loads(gzip.decompress(snap.read_bytes()))
    dest.mkdir(parents=True, exist_ok=True)
    state = json.loads((root / "state.json").read_text())["done"]
    stamp = digest(snap)
    log = dest.parent / "transport" / "checkpoints.json"
    done = json.loads(log.read_text()) if log.exists() else {}
    for s in names:
        import shutil

        if shutil.disk_usage(dest).free < 17 * 2**30:
            break
        prefix = root / "inputs" / s
        inputs = (
            {**state["streets-" + s], **state["detail-" + s]}
            if "detail-" + s in state
            else state["streets-" + s]
        )
        sources = [
            root / "packs/graph" / (s + ".json"),
            Path(str(prefix) + ".json.gz"),
            Path(str(prefix) + ".stops.json.gz"),
        ]
        hashes = [inputs.get(str(p.relative_to(root))) for p in sources]
        target = dest / (s + ".json")
        if (
            all(hashes)
            and done.get(s, {}).get("source") == [stamp, *hashes]
            and target.is_file()
            and digest(target) == done[s]["graph"]
        ):
            continue
        actual = [digest(p) for p in sources]
        if any(h and h != a for h, a in zip(hashes, actual)):
            raise ValueError("verified street input changed")
        graph = json.loads((root / "packs/graph" / (s + ".json")).read_text())
        obs = json.loads(gzip.decompress(Path(str(prefix) + ".json.gz").read_bytes()))
        photo = json.loads(
            gzip.decompress(Path(str(prefix) + ".stops.json.gz").read_bytes())
        )
        save(target, enrich(graph, obs, photo, city))
        done[s] = dict(source=[stamp, *actual], graph=digest(target))
        save(log, done)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("root", type=Path)
    cli.add_argument("out", type=Path)
    cli.add_argument("--pilot", action="store_true")
    a = cli.parse_args()
    names = (
        PILOT
        if a.pilot
        else sorted(
            k
            for k in json.loads((a.root / "state.json").read_text())["done"]
            if k[0].isdigit()
        )
    )
    build(a.root, a.out, names)
