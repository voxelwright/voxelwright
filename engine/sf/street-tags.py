"""What sf/marks.mjs needs of San Francisco's streets (#450) that the city run's street graphs do not keep, from the
same retained OSM observations (bay/street_sources.py): the rails set in the streets, and which roads are the city's
grid and which are out of the street (a tunnel or a bridge).

    ~/.village/engine/bay/venv/bin/python -I engine/sf/street-tags.py [--inputs DIR] [--out engine/sf/street-tags.json]

The city run's graphs keep a road's way, name and lanes but not its highway class or whether it is a tunnel or a
bridge (the pilot's six squares do), so no centre line could be drawn: `grid` lists the ways of primary, secondary
and tertiary roads and their links, `apart` those in a tunnel, on a bridge or under the ground. The observations the
city run retained have no tunnel, bridge or layer tags at all, so `apart` is asked of Overpass, once: without it the
Muni Metro's subway under Market Street and through Twin Peaks would be rails on the streets over it.

The street graph (bay/street_graph.py) keeps only the cable cars' 1067 mm ways as tracks, so the streetcars' 1435 mm
rails (the F and E on the Embarcadero and Market, the J, K, L, M, N and T where they run in the street) were never
drawn. Kept: railway tram, light_rail or cable_car with a gauge of 1067 or 1435, not in a tunnel, not on a bridge and
not below the ground (layer under 0): the Muni Metro's subway is out of sight. Ways that come in several squares'
observations are kept once. The file: {"tracks": [{"id", "gauge", "line": [[x, z], ...]}], "grid": [way ids],
"apart": [way ids]}, cells of 10 cm.
"""

import argparse
import gzip
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pyproj import Transformer

PROJECT = Transformer.from_crs(4326, 26910, always_xy=True)
INPUTS = Path.home() / ".village/engine/bay/sf-450-city/inputs"
GRID = {"primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"}


def cells(lon, lat):
    e, n = PROJECT.transform(lon, lat)
    return [round((e - 500000) * 10), round((4250000 - n) * 10)]


def apart_ways():
    """Every way of a road or a railway in the city that is in a tunnel, on a bridge or below the ground (Overpass)."""
    query = (
        '[out:json][timeout:120];(way["highway"]["tunnel"](37.70,-122.52,37.83,-122.35);way["highway"]["bridge"](37.70,-122.52,37.83,-122.35);'
        'way["railway"]["tunnel"](37.70,-122.52,37.83,-122.35);way["railway"]["bridge"](37.70,-122.52,37.83,-122.35);'
        'way["railway"]["layer"](37.70,-122.52,37.83,-122.35);way["railway"="subway"](37.70,-122.52,37.83,-122.35););out tags;'
    )
    for tries, host in enumerate(["overpass-api.de", "overpass.private.coffee", "overpass-api.de"]):
        try:
            request = Request(f"https://{host}/api/interpreter", data=urlencode({"data": query}).encode(), headers={"User-Agent": "village-engine"})
            with urlopen(request, timeout=180) as answer:
                elements = json.load(answer)["elements"]
            break
        except OSError as e:
            print(f"  Overpass at {host}: {e}")
            time.sleep(10 * (tries + 1))
    else:
        raise SystemExit("Overpass did not answer")
    out = set()
    for e in elements:
        t = e.get("tags", {})
        layer = t.get("layer", "0")
        under = layer.lstrip("-").isdigit() and int(layer) < 0
        if t.get("tunnel", "no") not in ("no",) or t.get("bridge", "no") not in ("no",) or under or t.get("railway") == "subway":
            out.add(e["id"])
    return out


def main():
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("--inputs", type=Path, default=INPUTS)
    cli.add_argument("--out", type=Path, default=Path(__file__).parent / "street-tags.json")
    a = cli.parse_args()
    ways, nodes, grid, apart = {}, {}, set(), apart_ways()
    squares = sorted(p for p in a.inputs.glob("*_*.json.gz") if p.name.count(".") == 4)
    for path in squares:
        with gzip.open(path) as stream:
            obs = json.load(stream)
        for i, w in obs["ways"].items():
            t = w["tags"]
            if t.get("highway") in GRID:
                grid.add(int(i))
            if t.get("railway") not in ("tram", "light_rail", "cable_car") or t.get("gauge") not in ("1067", "1435"):
                continue
            if int(i) in apart:
                continue
            if i in ways:
                continue
            if not all(str(n) in obs["nodes"] for n in w["nodes"]):
                continue
            ways[i] = (int(t["gauge"]), w["nodes"])
            for n in w["nodes"]:
                nodes[n] = obs["nodes"][str(n)]
    tracks = []
    for i, (gauge, ids) in sorted(ways.items(), key=lambda kv: int(kv[0])):
        line = [cells(*nodes[n][:2]) for n in ids]
        line = [p for k, p in enumerate(line) if k == 0 or p != line[k - 1]]
        if len(line) >= 2:
            tracks.append({"id": int(i), "gauge": gauge, "line": line})
    a.out.write_text(json.dumps({"tracks": tracks, "grid": sorted(grid), "apart": sorted(apart)}, separators=(",", ":")))
    by = {g: sum(1 for t in tracks if t["gauge"] == g) for g in (1067, 1435)}
    print(f"  {len(squares)} squares: {len(tracks)} ways of track ({by[1067]} cable car, {by[1435]} streetcar), {len(grid)} of the grid, {len(apart)} apart; {a.out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
