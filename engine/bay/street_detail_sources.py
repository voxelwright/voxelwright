"""Retain independent footprints, parcel attributes and mapped fixtures for the street bake."""

import gzip
import json
import os
from pathlib import Path
import zipfile
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from mapped_water import areas as water_areas
from street_sources import UTM, osm
from street_graph import cells


def records(dataset, select, where):
    query = urlencode({"$select": select, "$where": where, "$limit": 50000})
    with urlopen(
        f"https://data.sf.gov/resource/{dataset}.json?{query}", timeout=120
    ) as reply:
        rows = json.load(reply)
    if len(rows) >= 50000:
        raise ValueError(f"truncated {dataset} response")
    return rows


def acquire(archive, dest):
    with zipfile.ZipFile(archive) as src:
        frame = json.loads(src.read("frame.json"))
        known = {
            f["properties"]["sf16_bldgid"]
            for f in json.loads(src.read("footprints.geojson"))["features"]
        }
    w, n = frame["west"], frame["north"]
    corners = [
        UTM.transform(w + dx, n - dz)
        for dx, dz in [(0, 0), (1032, 0), (1032, 1032), (0, 1032)]
    ]
    west, south = map(min, zip(*corners))
    east, north = map(max, zip(*corners))
    boundary = ",".join(f"{x:.8f} {y:.8f}" for x, y in corners + corners[:1])
    more = records(
        "ynuv-fyni",
        "shape,sf16_bldgid,hgt_median_m,gnd_min_m",
        f"intersects(shape,'POLYGON(({boundary}))')",
    )
    missing = [
        {
            "id": r["sf16_bldgid"],
            "geometry": r["shape"],
            "height": r.get("hgt_median_m"),
        }
        for r in more
        if r["sf16_bldgid"] not in known
    ]
    lots = records(
        "wv5m-vpq2",
        "parcel_number,year_property_built,number_of_units,number_of_stories",
        f"closed_roll_year=2025 AND within_box(the_geom,{north},{west},{south},{east})",
    )
    assessor = {
        r["parcel_number"].strip(): [
            int(float(r.get(k) or 0))
            for k in ("year_property_built", "number_of_units", "number_of_stories")
        ]
        for r in lots
    }
    elements = {(e["type"], e["id"]): e for e in osm(west, south, east, north)}
    nodes = {
        i: cells(e["lon"], e["lat"])
        for (kind, i), e in elements.items()
        if kind == "node"
    }
    buildings, fixtures, wires = [], [], []
    osm_bldg_tags, osm_gardens = {}, []
    KEEP_BLDG = (
        "name", "building", "building:colour", "building:material",
        "roof:shape", "roof:colour", "roof:material", "height", "building:levels", "historic", "tourism",
    )
    trolley_ways = {
        m["ref"]
        for (kind, _), e in elements.items()
        if kind == "relation" and e.get("tags", {}).get("route") == "trolleybus"
        for m in e["members"]
        if m["type"] == "way"
    }
    for (kind, i), e in sorted(elements.items()):
        tags = e.get("tags", {})
        if kind == "node":
            fixture = None
            if tags.get("power") == "pole":
                fixture = (
                    "metalPole"
                    if tags.get("material") in ("steel", "metal", "concrete")
                    else "pole"
                )
            elif tags.get("highway") in ("street_lamp", "stop"):
                fixture = tags["highway"]
            elif tags.get("emergency") == "fire_hydrant":
                fixture = "hydrant"
            if fixture:
                fixtures.append([i, fixture, *nodes[i]])
        if kind != "way":
            continue
        line = [nodes[node] for node in e["nodes"]]
        if (
            tags.get("building") not in (None, "no", "roof")
            and len(line) >= 4
            and line[0] == line[-1]
        ):
            buildings.append([i, line[:-1]])
            kept_t = {k: tags[k] for k in KEEP_BLDG if k in tags}
            if len(kept_t) > 1 or kept_t.get("building") not in (None, "yes"):
                osm_bldg_tags[str(i)] = kept_t
        if (
            (tags.get("leisure") == "garden" or tags.get("landuse") == "flowerbed")
            and len(line) >= 4
            and line[0] == line[-1]
        ):
            osm_gardens.append([i, line[:-1], tags.get("garden:type") or tags.get("leisure") or tags.get("landuse")])
        wire = None
        if (
            tags.get("power") in ("minor_line", "line")
            and tags.get("location") != "underground"
        ):
            wire = "utility"
        elif tags.get("trolley_wire") == "yes" or i in trolley_ways:
            wire = "trolley"
        if wire:
            wires.append([i, wire, line])
    data = dict(
        square=frame["square"],
        version=1,
        extraDataSF=missing,
        osmBuildings=buildings,
        osmBuildingTags=osm_bldg_tags,
        osmWater=water_areas(elements, nodes),
        osmGardens=osm_gardens,
        assessor2025=assessor,
        fixtures=fixtures,
        wires=wires,
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(f".{os.getpid()}.part")
    with tmp.open("wb") as stream, gzip.GzipFile(
        filename="", fileobj=stream, mode="wb", mtime=0
    ) as out:
        out.write(json.dumps(data, separators=(",", ":"), sort_keys=True).encode())
    tmp.replace(dest)
    print(
        frame["square"],
        *(len(v) for v in (missing, buildings, assessor, fixtures, wires)),
        flush=True,
    )


def photo_points(name, category):
    e, n = (float(v) * 1000 for v in name.split("_"))
    corners = [UTM.transform(e + x, n + y) for x in (-24, 1024) for y in (-24, 1024)]
    west, south = map(min, zip(*corners))
    east, north = map(max, zip(*corners))
    token = (
        (Path.home() / ".village/engine/bay/keys/mapillary.token").read_text().strip()
    )
    points = {}

    def query(w, s, e, n):
        params = urlencode(
            dict(
                bbox=f"{w},{s},{e},{n}",
                fields="id,geometry,object_value",
                object_values=category,
                limit=2000,
            )
        )
        request = Request(
            "https://graph.mapillary.com/map_features?" + params,
            headers={"Authorization": "OAuth " + token},
        )
        with urlopen(request, timeout=90) as reply:
            data = json.load(reply)
        rows = data["data"]
        if len(rows) >= 2000 or data.get("paging", {}).get("next"):
            if e - w < 0.0001:
                raise ValueError("truncated pole observations")
            x, y = (e + w) / 2, (n + s) / 2
            for bbox in ((w, s, x, y), (x, s, e, y), (w, y, x, n), (x, y, e, n)):
                query(*bbox)
            return
        for r in rows:
            if r["object_value"] == category or (
                category.endswith("*") and r["object_value"].startswith(category[:-1])
            ):
                points[r["id"]] = cells(*r["geometry"]["coordinates"])

    query(west, south, east, north)
    return sorted(set(map(tuple, points.values())))


def stop_signs(name, dest):
    points = photo_points(name, "regulatory--stop--*")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(f".{os.getpid()}.part")
    with tmp.open("wb") as file, gzip.GzipFile(
        filename="", fileobj=file, mode="wb", mtime=0
    ) as out:
        out.write(
            json.dumps(
                dict(square=name, version=1, points=points), separators=(",", ":")
            ).encode()
        )
    tmp.replace(dest)
    print(name, "photo stop signs", len(points), flush=True)


def public_works(name, dest):
    """Surface fixtures visible in the Public Works map viewer, in engine cells."""
    e, n = (float(v) * 1000 for v in name.split("_"))
    bbox = f"{e-24},{n-24},{e+1024},{n+1024}"
    result = {}
    for layer, key in ((36, "lamps"), (48, "trolley")):
        base = f"https://maps.sfdpw.org/arcgis/rest/services/MapViewer/MapViewerLayers1/MapServer/{layer}/query?"

        def get(**params):
            with urlopen(base + urlencode({"f": "json", **params}), timeout=90) as r:
                data = json.load(r)
            if "error" in data:
                raise ValueError(f"Public Works layer {layer}: {data['error']['code']}")
            return data

        ids = sorted(
            set(
                get(
                    geometry=bbox,
                    inSR=26910,
                    geometryType="esriGeometryEnvelope",
                    spatialRel="esriSpatialRelIntersects",
                    returnIdsOnly="true",
                )["objectIds"]
                or []
            )
        )
        parts = []

        def project(x, y, *_):
            return [round((x - 500000) * 10), round((4250000 - y) * 10)]

        for start in range(0, len(ids), 160):
            batch = ids[start : start + 160]
            rows = get(
                objectIds=",".join(map(str, batch)),
                outSR=26910,
                outFields="FID",
                returnGeometry="true",
            )["features"]
            if {x["attributes"]["FID"] for x in rows} != set(batch):
                raise ValueError("incomplete street fixture response")
            for f in sorted(rows, key=lambda f: f["attributes"]["FID"]):
                g = f["geometry"]
                if key == "lamps":
                    parts.append(project(g["x"], g["y"]))
                else:
                    parts.extend([project(*p) for p in path] for path in g["paths"])
        result[key] = parts
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(f".{os.getpid()}.part")
    with tmp.open("wb") as f, gzip.GzipFile(
        filename="", fileobj=f, mode="wb", mtime=0
    ) as out:
        out.write(
            json.dumps(
                dict(
                    square=name,
                    version=2,
                    photoPoles=photo_points(name, "object--support--utility-pole"),
                    **result,
                ),
                separators=(",", ":"),
            ).encode()
        )
    tmp.replace(dest)
    print(
        name,
        "city lamps",
        len(result["lamps"]),
        "wire paths",
        len(result["trolley"]),
        flush=True,
    )


if __name__ == "__main__":
    import argparse
    import sys
    from street_inputs import fixture_option, sidecars

    parser = argparse.ArgumentParser(description=__doc__)
    fixture_option(parser)
    parser.add_argument("destination", type=Path)
    parser.add_argument("archives", type=Path, nargs="+")
    args = parser.parse_args()
    for archive in args.archives:
        for suffix, fetch in sidecars(archive, sys.modules[__name__], args.public_works_fixtures):
            dest = args.destination / (archive.stem + "." + suffix + ".json.gz")
            if not dest.exists():
                fetch(dest)
