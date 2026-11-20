"""Cache solved Mapillary panoramas around a single frontage survey, with a hard request budget."""

import argparse
import fcntl
import json
import math
import shutil
import time
import zipfile
from email.utils import parsedate_to_datetime
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

    def reserve(self, api):
        # The caller holds the single acquisition lock. Debit before I/O, including failures.
        path = self.root / "allowance.json"
        state = json.loads(path.read_text()) if path.exists() else {}
        now = time.time()
        history = [t for t in state.get("requests", []) if now - t < 86400]
        deadline = max(
            state.get("next", 0),
            history[-160] + 3600 if len(history) >= 160 else 0,
            history[-2400] + 86400 if len(history) >= 2400 else 0,
        )
        if deadline > now:
            state["next"] = deadline
            save(path, state)
            time.sleep(deadline - now)
        if shutil.disk_usage(self.root).free < 17 * (1 << 30):
            raise RuntimeError("disk reserve reached; progress saved")
        now = time.time()
        state.update(
            requests=[t for t in history if now - t < 86400] + [now],
            next=now + 1.12,
            total=state.get("total", 0) + 1,
            api=state.get("api", 0) + int(api),
        )
        save(path, state)
        return path, state

    def get(self, url, api=True):
        if self.count >= self.maximum:
            raise RuntimeError(
                "request budget exhausted; resume with the saved cameras"
            )
        path, state = self.reserve(api)
        self.count += 1
        self.api += int(api)
        headers = {"User-Agent": "Village-photo-bake"}
        if api:
            headers["Authorization"] = "OAuth " + self.token
        try:
            with urlopen(Request(url, headers=headers), timeout=40) as reply:
                data = reply.read()
                usage = json.loads(reply.headers.get("X-App-Usage", "{}"))
                if usage:
                    state["lastAppUsage"] = {
                        k: usage[k]
                        for k in ("call_count", "total_time", "total_cputime")
                        if k in usage
                    }
                    save(path, state)
                if (
                    max(
                        (v for v in usage.values() if isinstance(v, (int, float))),
                        default=0,
                    )
                    >= 75
                ):
                    state["next"] = time.time() + 3600
                    save(path, state)
        except HTTPError as e:
            if (
                api
                and url.startswith("https://graph.mapillary.com/")
                and e.code in (400, 404, 410)
            ):
                try:
                    error = json.loads(e.read(16384)).get("error", {})
                except (ValueError, OSError):
                    error = {}
                if e.code in (404, 410) or (
                    error.get("code") == 100 and error.get("error_subcode") == 33
                ):
                    return b"{}"
            wait = e.headers.get("Retry-After", "")
            if e.code in (400, 403, 429, 503) or wait:
                try:
                    delay = (
                        float(wait)
                        if wait.isdigit()
                        else parsedate_to_datetime(wait).timestamp() - time.time()
                    )
                except (TypeError, ValueError, OverflowError):
                    delay = 600
                state["next"] = max(state["next"], time.time() + max(60, delay))
                save(path, state)
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


def select(
    place,
    center,
    yaw,
    square,
    holdouts,
    root,
    requests,
    limit,
    shared=None,
    radius=RADIUS,
):
    dest = root / place
    dest.mkdir(exist_ok=True)
    objects = shared or dest
    objects.mkdir(exist_ok=True)
    cx, cz = center
    lon, lat = TO_LL.transform(500000 + cx, 4250000 - cz)
    # The tile spans about 1.93 km at this latitude. Visit both sides of every survey edge.
    tile_margin = radius / (2446 * math.cos(math.radians(lat))) + 0.001
    fx = (lon + 180) / 360 * 16384
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * 8192
    candidates = {}
    # Fetch every image-point tile intersecting the local 90 m search.
    for tx in range(math.floor(fx - tile_margin), math.floor(fx + tile_margin) + 1):
        for ty in range(math.floor(fy - tile_margin), math.floor(fy + tile_margin) + 1):
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
                if 5 < d < radius:
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
            meta, jpg = objects / (ident + ".json"), objects / (ident + ".jpg")
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
            if not 5 <= math.hypot(sx - cx, sz - cz) <= radius or any(
                math.hypot(sx - u, sz - v) < 7 for u, v in keep
            ):
                continue
            jpg.touch()
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
