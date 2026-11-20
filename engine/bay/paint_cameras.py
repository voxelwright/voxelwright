"""Cache solved Mapillary panoramas around a single frontage survey, with a hard request budget."""

import argparse
import fcntl
import json
import math
import shutil
import time
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import mapbox_vector_tile
from panoramas import TO_LL, TO_UTM
from full_run import BAY, save

RADIUS = 90


class Requests:
    def __init__(self, root, maximum):
        self.root = root
        self.maximum = maximum
        self.count = self.api = self.bytes = 0
        self.token = (BAY / "keys/mapillary.token").read_text().strip()

    def get(self, url, api=True):
        if shutil.disk_usage(self.root).free < 15 * (1 << 30) + (16 << 20):
            raise RuntimeError("15 GiB reserve reached; progress saved")
        if self.count >= self.maximum:
            raise RuntimeError(
                "request budget exhausted; resume with the saved cameras"
            )
        # Sequential, including CDN thumbnails. Persist the cooldown across invocations.
        checkpoint = self.root / "next-request"
        if checkpoint.exists():
            time.sleep(max(0, float(checkpoint.read_text()) - time.time()))
        self.count += 1
        self.api += int(api)
        checkpoint.write_text(str(time.time() + 1.1))
        headers = {"User-Agent": "Village-photo-bake"}
        if api:
            headers["Authorization"] = "OAuth " + self.token
        try:
            with urlopen(Request(url, headers=headers), timeout=40) as reply:
                data = reply.read()
        except HTTPError as e:
            wait = e.headers.get("Retry-After", "")
            if e.code == 429 or e.code == 403 or e.code == 400:
                checkpoint.write_text(
                    str(time.time() + (int(wait) if wait.isdigit() else 600))
                )
            raise RuntimeError(
                f"image request returned HTTP {e.code}; progress saved"
            ) from None
        except (URLError, TimeoutError):
            raise RuntimeError("image request failed; progress saved") from None
        self.bytes += len(data)
        return data


def xy(photo):
    e, n = TO_UTM.transform(*photo["computed_geometry"]["coordinates"])
    return e - 500000, 4250000 - n


def select(place, center, yaw, square, holdouts, root, requests, limit):
    dest = root / place
    dest.mkdir(exist_ok=True)
    cx, cz = center
    lon, lat = TO_LL.transform(500000 + cx, 4250000 - cz)
    fx = (lon + 180) / 360 * 16384
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * 8192
    candidates = {}
    # Fetch every image-point tile intersecting the local 90 m search.
    for tx in range(math.floor(fx - 0.05), math.floor(fx + 0.05) + 1):
        for ty in range(math.floor(fy - 0.05), math.floor(fy + 0.05) + 1):
            name = f"images-{tx}-{ty}.mvt"
            caches = (
                root / name,
                BAY / "sf-450-city/raw" / name,
                BAY / "450-photo-inputs" / name,
            )
            tile = next((p for p in caches if p.exists()), None)
            if tile is None:
                tile = root / name
                blob = requests.get(
                    f"https://tiles.mapillary.com/maps/vtp/mly1_public/2/14/{tx}/{ty}?access_token="
                    + requests.token
                )
                tmp = tile.with_suffix(".part")
                tmp.write_bytes(blob)
                tmp.replace(tile)
            layer = mapbox_vector_tile.decode(tile.read_bytes()).get("image", {})
            for f in layer.get("features", []):
                p = f["properties"]
                if not p.get("is_pano") or str(p["id"]) in holdouts:
                    continue
                a, b = f["geometry"]["coordinates"]
                lng = (tx + a / layer["extent"]) / 16384 * 360 - 180
                lat = math.degrees(
                    math.atan(
                        math.sinh(
                            math.pi * (1 - 2 * (ty + 1 - b / layer["extent"]) / 16384)
                        )
                    )
                )
                e, n = TO_UTM.transform(lng, lat)
                x, z = e - 500000, 4250000 - n
                d = math.hypot(x - cx, z - cz)
                if 5 < d < 90:
                    candidates[str(p["id"])] = (x, z, p["captured_at"])
    # Reuse archived solves where available. Spread positions both along and across the street.
    keep = []
    with zipfile.ZipFile(BAY / "sf-450-city/inputs" / (square + ".zip")) as src:
        catalog = {str(p["id"]): p for p in json.loads(src.read("photos/cameras.json"))}
        angle = math.radians(yaw)

        # Sample the target street first. Starting with the newest sequence in
        # a dense block can spend the entire budget on a parallel street.
        def rank(k):
            x, z, stamp = candidates[k]
            along = (x - cx) * math.sin(angle) - (z - cz) * math.cos(angle)
            across = (x - cx) * math.cos(angle) + (z - cz) * math.sin(angle)
            distance = math.hypot(along - 12, 2.5 * across)
            return math.floor(distance / 8), -stamp, k

        for ident in sorted(candidates, key=rank):
            x, z, _ = candidates[ident]
            if any(math.hypot(x - cx2, z - cz2) < 10 for cx2, cz2 in keep):
                continue
            meta, jpg = dest / (ident + ".json"), dest / (ident + ".jpg")
            if not meta.exists() or (not jpg.exists() and json.loads(meta.read_text())):
                if ident in catalog:
                    p = catalog[ident]
                    data = src.read("photos/" + ident + ".jpg")
                else:
                    p = json.loads(
                        requests.get(
                            f"https://graph.mapillary.com/{ident}?fields=id,camera_type,computed_geometry,computed_rotation,captured_at,thumb_2048_url"
                        )
                    )
                    url = p.pop("thumb_2048_url", None)
                    if not (
                        url
                        and p.get("computed_geometry")
                        and p.get("computed_rotation")
                        and p.get("camera_type") == "spherical"
                    ):
                        save(meta, {})
                        continue
                    data = requests.get(url, False)
                jpg.with_suffix(".part").write_bytes(data)
                jpg.with_suffix(".part").replace(jpg)
                save(meta, p)
            p = json.loads(meta.read_text())
            if not p:
                continue
            sx, sz = xy(p)
            if not 5 <= math.hypot(sx - cx, sz - cz) <= RADIUS or any(
                math.hypot(sx - u, sz - v) < 7 for u, v in keep
            ):
                continue
            keep.append((sx, sz))
            yield p
            if len(keep) >= limit:
                return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("poses", type=Path)
    parser.add_argument("places", nargs="+")
    parser.add_argument("--images", type=int, default=18)
    parser.add_argument("--requests", type=int, default=165)
    parser.add_argument(
        "--sites",
        type=Path,
        help="place and square inventory for additional street windows",
    )
    args = parser.parse_args()
    rows = json.loads(Path(__file__).with_name("neighbourhoods.json").read_text())
    holdouts = {r["image"] for r in rows}
    if args.sites:
        rows = json.loads(args.sites.read_text())
    sites = {r["place"]: r["square"] for r in rows}
    if any(
        name not in sites or Path(name).name != name or name in ("", ".", "..")
        for name in args.places
    ):
        parser.error("unknown place or invalid cache directory name")
    poses = json.loads(args.poses.read_text())
    args.root.mkdir(exist_ok=True, parents=True)
    with (args.root / ".acquire.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        acquire_places(args, sites, poses, holdouts)


def acquire_places(args, sites, poses, holdouts):
    req = Requests(args.root, args.requests)
    for place in args.places:
        pose = poses[place]["street"]
        start = time.monotonic()
        before = (req.count, req.api, req.bytes)
        try:
            photos = list(
                select(
                    place,
                    (pose[0], pose[2]),
                    pose[3],
                    sites[place],
                    holdouts,
                    args.root,
                    req,
                    args.images,
                )
            )
            save(args.root / place / "cameras.json", photos)
        finally:
            meter = dict(
                requests=req.count - before[0],
                api=req.api - before[1],
                bytes=req.bytes - before[2],
                seconds=round(time.monotonic() - start, 2),
            )
            with (args.root / place / "requests.jsonl").open("a") as log:
                log.write(json.dumps(meter) + "\n")
            print(place, meter, flush=True)


if __name__ == "__main__":
    main()
