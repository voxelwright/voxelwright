"""Retain the OSM geometry and business categories needed for offline street detail."""

import gzip
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pyproj import Transformer

UTM = Transformer.from_crs(26910, 4326, always_xy=True)
KEEP = set(
    "name ref tunnel bridge layer highway footway cycleway crossing crossing:markings railway gauge operator electrified route type restriction oneway junction lanes lanes:forward lanes:backward access motor_vehicle service surface sidewalk parking:both parking:left parking:right parking:lane:both parking:lane:left parking:lane:right".split()
)


def osm(w, s, e, n):
    query = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w:.7f},{s:.7f},{e:.7f},{n:.7f}"
    try:
        with urlopen(
            Request(
                query,
                headers={"User-Agent": "village-engine", "Accept-Encoding": "gzip"},
            ),
            timeout=90,
        ) as response:
            data = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
            return json.loads(data)["elements"]
    except HTTPError as err:
        if err.code != 400 or e - w < 0.002:
            raise
    mx, my = (w + e) / 2, (s + n) / 2
    return [
        item
        for box in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n))
        for item in osm(*box)
    ]


def acquire(name, path):
    if path.exists():
        return
    e, n = (float(v) * 1000 for v in name.split("_"))
    points = [UTM.transform(e + i, n + j) for i in (-30, 1030) for j in (-30, 1030)]
    w, s = min(x for x, y in points), min(y for x, y in points)
    east, north = max(x for x, y in points), max(y for x, y in points)
    items = {(a["type"], a["id"]): a for a in osm(w, s, east, north)}
    ways = {}
    relations = []
    nodes = set()
    for (kind, id_), item in items.items():
        tags = item.get("tags", {})
        if kind == "way" and ("highway" in tags or "railway" in tags):
            ways[id_] = {
                "nodes": item["nodes"],
                "tags": {k: v for k, v in tags.items() if k in KEEP},
            }
            nodes.update(item["nodes"])
        if kind == "relation" and (
            tags.get("type") == "restriction" or tags.get("route") == "tram"
        ):
            relations.append(
                {
                    "members": item["members"],
                    "tags": {k: v for k, v in tags.items() if k in KEEP},
                }
            )
    coords = {
        id_: [
            items["node", id_]["lon"],
            items["node", id_]["lat"],
            items["node", id_].get("tags", {}).get("highway"),
        ]
        for id_ in sorted(nodes)
    }
    q = {
        "$select": "location,self_reported_naics_code,parking_tax",
        "$where": f"location_end_date IS NULL AND within_box(location,{north},{w},{s},{east})",
        "$limit": "50000",
    }
    with urlopen(
        "https://data.sfgov.org/resource/g8m3-pdis.json?" + urlencode(q), timeout=90
    ) as response:
        businesses = json.load(response)
    if len(businesses) >= 50000:
        raise ValueError("truncated business query")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    with gzip.open(tmp, "wt") as stream:
        json.dump(
            {
                "roadTagVersion": 1,
                "ways": ways,
                "nodes": coords,
                "relations": relations,
                "businesses": businesses,
            },
            stream,
            separators=(",", ":"),
        )
    tmp.replace(path)
    print(name, len(ways), len(coords), len(businesses), flush=True)


if __name__ == "__main__":
    from full_run import PILOT

    for name in PILOT:
        acquire(name, Path(sys.argv[1]) / (name + ".json.gz"))
