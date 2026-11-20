"""Local BAY1 storage. Checkpoints and release hashes always describe decoded bytes."""

from contextlib import closing
from hashlib import sha256
import json
import fcntl
import os
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import sys
import zlib

ZSTD = shutil.which("zstd") or "/opt/homebrew/bin/zstd"


def packed(path):
    return Path(str(path) + ".zst")


def read(path):
    path = Path(path)
    try:
        return path.read_bytes()
    except FileNotFoundError:
        if not packed(path).is_file():
            raise
        return decompress(packed(path))


def decompress(path):
    with Path(path).open("rb") as source:
        return subprocess.run(
            [ZSTD, "-qdc"], stdin=source, capture_output=True, check=True
        ).stdout


def put_base(store, data, expected):
    if sha256(data).hexdigest() != expected:
        raise ValueError("base differs from its decoded checkpoint")
    path = store / "bases" / expected[:2] / (expected + ".zst")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
            try:
                subprocess.run(
                    [ZSTD, "-q", "-3", "-c"], input=data, stdout=tmp, check=True
                )
                tmp.flush()
                os.fsync(tmp.fileno())
                if sha256(decompress(tmp.name)).hexdigest() != expected:
                    raise ValueError("zstd round trip differs")
                os.replace(tmp.name, path)
            finally:
                Path(tmp.name).unlink(missing_ok=True)
    elif sha256(decompress(path)).hexdigest() != expected:
        raise ValueError("stored base differs")
    return path


def compact(path, store, expected):
    """Switch one checkpoint only after its canonical target reconstructs the original."""
    path = Path(path)
    link = packed(path)
    if not path.is_file():
        if sha256(decompress(link)).hexdigest() != expected:
            raise ValueError(f"stored checkpoint differs: {path}")
        return
    target = put_base(store, path.read_bytes(), expected)
    tmp = link.with_suffix(".link")
    tmp.unlink(missing_ok=True)
    tmp.symlink_to(os.path.relpath(target.resolve(), link.parent.resolve()))
    tmp.replace(link)
    if sha256(decompress(link)).hexdigest() != expected:
        raise ValueError(f"compressed checkpoint differs: {path}")
    path.unlink()


def split_tile(blob):
    """Locate SFPT structurally. The same magic can occur inside a terrain sample."""
    h = struct.unpack_from("<16i", blob)
    if h[0] != 0x31594142:
        raise ValueError("invalid BAY1 tile")
    end = (
        64
        + 2 * h[5] ** 2
        + (4 + 2 * (h[15] & 1)) * h[9] ** 2
        + 24 * h[12]
        + 12 * h[13]
        + 16 * h[14]
    )
    if blob[end : end + 4] == b"SFST":
        end += 8 + 32 * struct.unpack_from("<I", blob, end + 4)[0]
    if end == len(blob):
        return blob, None
    if blob[end : end + 4] != b"SFPT":
        raise ValueError("unrecognized release tile trailer")
    count = struct.unpack_from("<I", blob, end + 4)[0]
    pos = end + 8
    rows = []
    for _ in range(count):
        edge, _, width, height = struct.unpack_from("<IiHH", blob, pos)
        if edge >= h[13] or not width or not height:
            raise ValueError("invalid wall paint record")
        stop = pos + 12 + width * height
        rows.append(blob[pos:stop])
        pos = stop
    if pos != len(blob):
        raise ValueError("truncated tile paint")
    return blob[:end], rows


class TileStore:
    """One compressed geometry base and one copy of each immutable SFPT row across pins."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / "tiles.sqlite", timeout=90)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS wall(id INTEGER PRIMARY KEY, hash BLOB UNIQUE, data BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS tile(hash TEXT PRIMARY KEY, base TEXT NOT NULL, rows BLOB);
        """
        )

    def close(self):
        self.db.close()

    def put(self, data):
        digest = sha256(data).hexdigest()
        if not self.db.execute("SELECT 1 FROM tile WHERE hash=?", (digest,)).fetchone():
            base, walls = split_tile(data)
            base_hash = sha256(base).hexdigest()
            put_base(self.root, base, base_hash)
            ids = bytearray()
            with self.db:
                for row in walls or ():
                    key = sha256(row).digest()
                    self.db.execute(
                        "INSERT OR IGNORE INTO wall(hash,data) VALUES(?,?)",
                        (key, zlib.compress(row)),
                    )
                    (ident,) = self.db.execute(
                        "SELECT id FROM wall WHERE hash=?", (key,)
                    ).fetchone()
                    ids.extend(struct.pack("<Q", ident))
                self.db.execute(
                    "INSERT OR IGNORE INTO tile VALUES(?,?,?)",
                    (digest, base_hash, None if walls is None else bytes(ids)),
                )
        # This also verifies caches or a concurrently installed recipe before the caller can discard anything.
        self.get(digest)
        return digest

    def get(self, digest):
        result = self.db.execute(
            "SELECT base,rows FROM tile WHERE hash=?", (digest,)
        ).fetchone()
        if result is None:
            raise ValueError(f"missing compact tile {digest}")
        base, ids = result
        if not re.fullmatch("[0-9a-f]{64}", base):
            raise ValueError("invalid stored base hash")
        body = decompress(self.root / "bases" / base[:2] / (base + ".zst"))
        if sha256(body).hexdigest() != base:
            raise ValueError("damaged compressed geometry")
        if ids is not None:
            parts = [body, struct.pack("<4sI", b"SFPT", len(ids) // 8)]
            for (ident,) in struct.iter_unpack("<Q", ids):
                (row,) = self.db.execute(
                    "SELECT data FROM wall WHERE id=?", (ident,)
                ).fetchone()
                parts.append(zlib.decompress(row))
            body = b"".join(parts)
        if sha256(body).hexdigest() != digest:
            raise ValueError(f"tile reconstruction differs: {digest}")
        return body


def link_libraries(store, dest, files, hashes):
    """Share an immutable names/graph/life/cars/far directory between successive paint pins."""
    kinds = sorted({Path(name).parts[0] for name in files})
    for kind in kinds:
        members = {
            str(Path(name).relative_to(kind)): hashes[name]
            for name in sorted(files)
            if Path(name).parts[0] == kind
        }
        fingerprint = sha256(json.dumps(members, sort_keys=True).encode()).hexdigest()
        pool = store / "libraries" / kind
        pool.mkdir(parents=True, exist_ok=True)
        bundle = pool / fingerprint
        with (pool / "write.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if not bundle.exists():
                with tempfile.TemporaryDirectory(dir=pool) as temp:
                    stage = Path(temp) / "files"
                    for rel, expected in members.items():
                        f = stage / rel
                        f.parent.mkdir(parents=True, exist_ok=True)
                        source = files[kind + "/" + rel]
                        if sys.platform == "darwin":
                            subprocess.run(
                                ["/bin/cp", "-c", source.resolve(), f], check=True
                            )
                        else:
                            shutil.copyfile(source, f)
                        if sha256(f.read_bytes()).hexdigest() != expected:
                            raise ValueError(f"library object changed: {kind}/{rel}")
                    stage.rename(bundle)
            else:
                for rel, expected in members.items():
                    if sha256((bundle / rel).read_bytes()).hexdigest() != expected:
                        raise ValueError(f"stored library differs: {kind}/{rel}")
        link = dest / kind
        if link.exists():
            # A historical plain release can have the same digest and is already shared publicly with other lanes.
            for rel, expected in members.items():
                if sha256((link / rel).read_bytes()).hexdigest() != expected:
                    raise ValueError(f"existing release object differs: {kind}/{rel}")
        else:
            link.symlink_to(os.path.relpath(bundle.resolve(), dest.resolve()))


def archive_candidate(out, candidate, latest):
    """Compress only an unpublished, superseded city manifest. All its objects remain addressable."""
    if (
        not candidate
        or candidate == latest
        or not re.fullmatch("[0-9a-f]{64}", candidate)
    ):
        return
    dest = out / "releases" / candidate
    marker = dest / ".bay-store"
    with (out / ".promote.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pointer = out / "current.json"
        if (
            pointer.exists()
            and json.loads(pointer.read_bytes())["release"] == candidate
        ) or any(dest.glob("panel-*.json")):
            return
        if marker.is_symlink():
            with (out / (".stage-" + candidate + ".lock")).open("a") as staging:
                fcntl.flock(staging, fcntl.LOCK_EX)
                compact(dest / "manifest.json", marker.resolve(), candidate)


def export(manifest, out, wanted=None):
    """Export the pinned wire objects one at a time. A caller can request just one relative path."""
    manifest_bytes = read(manifest)
    obj = json.loads(manifest_bytes)
    pin = sha256(manifest_bytes).hexdigest()
    if pin != manifest.parent.name:
        raise ValueError("manifest differs from release pin")

    def records(node):
        if isinstance(node, dict):
            if {"path", "sha256", "bytes"} <= node.keys():
                yield node
            else:
                for v in node.values():
                    yield from records(v)
        elif isinstance(node, list):
            for v in node:
                yield from records(v)

    found = 0
    with closing(TileStore(manifest.parent / ".bay-store")) as store:
        for rec in records(obj):
            name = rec["path"]
            if wanted and name != wanted:
                continue
            rel = Path(name)
            if rel.is_absolute() or ".." in rel.parts:
                raise ValueError("invalid manifest path")
            body = (
                store.get(rec["sha256"])
                if name.startswith("tiles/")
                else (manifest.parent / rel).read_bytes()
            )
            if len(body) != rec["bytes"] or sha256(body).hexdigest() != rec["sha256"]:
                raise ValueError(f"release object differs: {name}")
            target = out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as f:
                f.write(body)
            os.replace(f.name, target)
            found += 1
    if wanted and not found:
        raise ValueError("object absent from pin")
    if not wanted:
        (out / "manifest.json").write_bytes(manifest_bytes)
    return found


def import_pin(manifest, objects):
    """Register a previously issued ordinary pin, leaving its shared static files available."""
    if sha256(manifest.read_bytes()).hexdigest() != manifest.parent.name:
        raise ValueError("manifest changed since pin")
    listing = json.loads(manifest.read_bytes())
    count = 0
    with closing(TileStore(objects)) as store:
        for level in listing["levels"]:
            for row in level["tiles"].values():
                source = (manifest.parent / row["path"]).read_bytes()
                if len(source) != row["bytes"] or store.put(source) != row["sha256"]:
                    raise ValueError(f"historical tile changed: {row['path']}")
                count += 1
    locator = manifest.parent / ".bay-store"
    if locator.is_symlink():
        if locator.resolve() != objects.resolve():
            raise ValueError("pin uses a different store")
    else:
        locator.symlink_to(
            os.path.relpath(objects.resolve(), manifest.parent.resolve())
        )
    return count


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=export.__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--object")
    parser.add_argument(
        "--import-pin",
        action="store_true",
        help="populate the output store from an existing decoded release",
    )
    args = parser.parse_args()
    if args.import_pin:
        print(
            import_pin(args.manifest, args.output), "pinned tiles stored and verified"
        )
    else:
        print(
            export(args.manifest, args.output, args.object),
            "objects verified and exported",
        )
