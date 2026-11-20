"""Cache solved Mapillary panoramas around a single frontage survey, with a hard request budget."""

import argparse
from contextlib import contextmanager
from functools import lru_cache
import tempfile
import fcntl
import json
import math
import os
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


# Mapillary documents per-app limits of 60,000 entity requests a minute and 50,000
# vector tiles a day. All workers share one clock: at most 1,000 requests a minute
# (one every 60 ms), and tiles stop at 80% of the daily cap.
GAP = 0.06
TILES_A_DAY = 40_000
RESERVE = 18 * 2**30
LIMIT_COOLDOWN = 600


def limited(error):
    return (
        error.get("code") == 4
        or "application request limit reached" in str(error.get("message", "")).lower()
    )


class Requests:
    def __init__(self, root, maximum):
        self.root = root
        self.maximum = maximum
        self.count = self.api = self.bytes = 0
        self.token = (BAY / "keys/mapillary.token").read_text().strip()

    @contextmanager
    def allowance(self):
        path = self.root / "allowance.json"
        with (self.root / "allowance.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = json.loads(path.read_text()) if path.exists() else {}
            yield state
            atomic_bytes(path, json.dumps(state, separators=(",", ":")).encode())

    def reserve(self, api, tile=False):
        # Debit before I/O, including failures. A cooldown in "next" holds every worker.
        while True:
            with self.allowance() as state:
                now = time.time()
                # The hourly pacer's history held every kind of request. Count it as tiles.
                tiles = [
                    t
                    for t in state.pop("requests", []) + state.get("tiles", [])
                    if t > now - 86400
                ]
                state["tiles"] = tiles
                deadline = state.get("next", 0)
                if tile and len(tiles) >= TILES_A_DAY:
                    deadline = max(deadline, tiles[-TILES_A_DAY] + 86400)
                if now >= deadline:
                    if shutil.disk_usage(self.root).free < RESERVE:
                        raise RuntimeError("disk reserve reached")
                    minute = int(now // 60)
                    minutes = {
                        k: v
                        for k, v in state.get("minutes", {}).items()
                        if int(k) > minute - 1440
                    }
                    minutes[str(minute)] = minutes.get(str(minute), 0) + 1
                    state.update(
                        tiles=tiles + [now] if tile else tiles,
                        minutes=minutes,
                        next=now + GAP,
                        total=state.get("total", 0) + 1,
                        api=state.get("api", 0) + int(api),
                    )
                    return
            time.sleep(min(60, max(0.005, deadline - now)))

    def cooldown(self, seconds, reason):
        with self.allowance() as state:
            now = time.time()
            state["next"] = max(state.get("next", 0), now + seconds)
            state["lastCooldown"] = dict(reason=reason, at=now, until=state["next"])

    def strike(self, reason):
        # An isolated failure backs off briefly. Repeats within ten minutes escalate to the limit cooldown.
        with self.allowance() as state:
            now = time.time()
            strikes = [t for t in state.get("strikes", []) if t > now - 600] + [now]
            seconds = min(LIMIT_COOLDOWN, 15 * 2 ** (len(strikes) - 1))
            state.update(strikes=strikes, next=max(state.get("next", 0), now + seconds))
            state["lastCooldown"] = dict(reason=reason, at=now, until=state["next"])

    def get(self, url, api=True):
        if self.count >= self.maximum:
            raise RuntimeError("window request budget exhausted")
        self.reserve(api, url.startswith("https://tiles.mapillary.com/"))
        self.count += 1
        self.api += int(api)
        headers = {"User-Agent": "Village-photo-bake"}
        if api:
            headers["Authorization"] = "OAuth " + self.token
        try:
            with urlopen(Request(url, headers=headers), timeout=40) as reply:
                data = reply.read()
                usage = json.loads(reply.headers.get("X-App-Usage", "{}"))
        except HTTPError as e:
            try:
                error = json.loads(e.read(16384)).get("error", {})
            except (ValueError, OSError):
                error = {}
            wait = e.headers.get("Retry-After", "")
            if e.code == 429 or limited(error) or wait:
                delay = LIMIT_COOLDOWN
                try:
                    delay = max(
                        delay,
                        float(wait)
                        if wait.isdigit()
                        else parsedate_to_datetime(wait).timestamp() - time.time(),
                    )
                except (TypeError, ValueError, OverflowError):
                    pass
                self.cooldown(delay, f"HTTP {e.code} limit")
            elif url.startswith("https://graph.mapillary.com/") and (
                e.code in (404, 410)
                or (error.get("code") == 100 and error.get("error_subcode") == 33)
            ):
                # The image no longer exists. Record it as unusable.
                return b"{}"
            else:
                self.strike(f"HTTP {e.code}")
            raise RuntimeError(f"image request returned HTTP {e.code}") from None
        except (URLError, TimeoutError, ConnectionError):
            self.strike("network")
            raise RuntimeError("image request failed") from None
        if usage:
            with self.allowance() as state:
                state["lastAppUsage"] = {
                    k: usage[k]
                    for k in ("call_count", "total_time", "total_cputime")
                    if k in usage
                }
                if max(state["lastAppUsage"].values(), default=0) >= 75:
                    state["next"] = max(state.get("next", 0), time.time() + 3600)
                    state["lastCooldown"] = dict(reason="app usage", until=state["next"])
        if api and data.lstrip().startswith(b"{"):
            try:
                error = json.loads(data).get("error", {})
            except ValueError:
                error = {}
            if limited(error):
                self.cooldown(LIMIT_COOLDOWN, "app limit")
                raise RuntimeError("Mapillary application request limit reached")
        self.bytes += len(data)
        return data


@lru_cache(maxsize=4)
def panoramas(tile, tx, ty):
    layer = mapbox_vector_tile.decode(tile.read_bytes()).get("image", {})
    points = []
    for f in layer.get("features", []):
        p = f["properties"]
        if not p.get("is_pano"):
            continue
        a, b = f["geometry"]["coordinates"]
        lng = (tx + a / layer["extent"]) / 16384 * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + 1 - b / layer["extent"]) / 16384))))
        e, n = TO_UTM.transform(lng, lat)
        points.append((str(p["id"]), e - 500000, 4250000 - n, p["captured_at"]))
    return points


def atomic_bytes(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        temp = Path(f.name)
        try:
            f.write(data)
            f.flush()
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


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
                atomic_bytes(tile, blob)
            for ident, x, z, stamp in panoramas(tile, tx, ty):
                if ident not in holdouts and 5 < math.hypot(x - cx, z - cz) < radius:
                    candidates[ident] = (x, z, stamp)
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
                        atomic_bytes(meta, b"{}")
                        continue
                    data = requests.get(url, False)
                atomic_bytes(jpg, data)
                atomic_bytes(meta, json.dumps(p).encode())
            p = json.loads(meta.read_text())
            if not p:
                continue
            sx, sz = xy(p)
            if not 5 <= math.hypot(sx - cx, sz - cz) <= radius or any(
                math.hypot(sx - u, sz - v) < 7 for u, v in keep
            ):
                continue
            # Refresh the cache clock. A pruned image fails the window instead of becoming empty.
            os.utime(jpg)
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
