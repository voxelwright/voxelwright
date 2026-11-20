import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from contextlib import closing

from compact_store import TileStore, compact, packed, read


class CompactStoreTest(unittest.TestCase):
    def test_corrupt_base_keeps_original_and_restart_recovers_both_copies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "square.bay"
            data = b"BAY1" * 8192
            digest = hashlib.sha256(data).hexdigest()
            path.write_bytes(data)
            compact(path, root, digest)
            self.assertEqual(read(path), data)
            path.write_bytes(data)
            target = packed(path).resolve()
            good = target.read_bytes()
            target.write_bytes(good[:-3])
            with self.assertRaises(Exception):
                compact(path, root, digest)
            self.assertEqual(path.read_bytes(), data)
            target.write_bytes(good)
            compact(path, root, digest)
            compact(path, root, digest)
            self.assertEqual(read(path), data)

    def test_two_pins_share_geometry_and_walls_preserving_order(self):
        with tempfile.TemporaryDirectory() as tmp, closing(TileStore(tmp)) as store:
            header = struct.pack(
                "<16i", 0x31594142, 0, 0, 2500, 10, 1, 0, 0, 5, 2, 0, 0, 0, 2, 0, 0
            )
            base = header + bytes(2 + 4 * 4 + 2 * 12)
            walls = [struct.pack("<IiHHB", edge, 13, 1, 1, 87) for edge in (1, 0)]
            for n in range(3):
                tile = base + struct.pack("<4sI", b"SFPT", n) + b"".join(walls[:n])
                digest = store.put(tile)
                self.assertEqual(store.get(digest), tile)
            self.assertEqual(len(list(Path(tmp).rglob("*.zst"))), 1)
            self.assertEqual(
                store.db.execute("select count(*) from wall").fetchone()[0], 2
            )
            store.db.execute("update wall set data=x'00' where id=1")
            with self.assertRaises(Exception):
                store.get(digest)
