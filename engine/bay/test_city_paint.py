"""Regression checks for persisted request debits, tile inheritance and the park exclusion."""

import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from paint_cameras import Requests
from paint_tile import EYE, without_eye_trees


class Reserve(unittest.TestCase):
    def test_crash_cannot_reset_the_hour_or_retry_deadline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "allowance.json"
            path.write_text(
                json.dumps(
                    dict(
                        requests=[100.0 + i for i in range(160)],
                        next=8000,
                        total=200,
                        api=91,
                    )
                )
            )
            req = Requests.__new__(Requests)
            req.root = root
            clock = [500.0]

            def wait(secs):
                clock[0] += secs

            with (
                patch("paint_cameras.time.time", side_effect=lambda: clock[0]),
                patch("paint_cameras.time.sleep", side_effect=wait),
                patch("paint_cameras.shutil.disk_usage") as disk,
            ):
                disk.return_value.free = 30 * 2**30
                req.reserve(False)
                first = json.loads(path.read_text())
                req.reserve(True)
                last = json.loads(path.read_text())
                self.assertEqual(first["requests"][-1], 8000.0)
                self.assertGreaterEqual(
                    last["requests"][-1] - first["requests"][-1], 1.1
                )
                self.assertEqual((last["total"], last["api"]), (202, 92))
                # A restart with a full rolling-hour allowance debits only after its oldest request expires.
                path.write_text(json.dumps(dict(requests=[8000.0] * 160, next=8001.12)))
                req.reserve(True)
                self.assertEqual(json.loads(path.read_text())["requests"][-1], 11600.0)


class Park(unittest.TestCase):
    def test_ground_roof_and_outside_stem_survive(self):
        x, z = EYE
        h = [0x31594142, x, z, 2500, 10, 1, x, z, 5, 2, x, z, 0, 0, 2, 0]
        data = (
            struct.pack("<16i", *h)
            + struct.pack("<5h", 25, 100, 200, 300, 400)
            + bytes([8 | 2, 1, 6, 8 | 1])
            + bytes(4)
            + struct.pack("<8i", x, z, 90, 2, x + 400, z, 100, 3)
        )
        out = without_eye_trees(data)
        self.assertEqual(
            struct.unpack_from("<5h", out, 64), (25, -32768, 200, 300, -32768)
        )
        self.assertEqual(out[74:78], bytes([2, 1, 6, 1]))
        self.assertEqual(struct.unpack_from("<i", out, 56), (1,))
        self.assertEqual(
            struct.unpack_from("<4i", out, len(out) - 16), (x + 400, z, 100, 3)
        )
        self.assertEqual(without_eye_trees(out), out)


class ResumableCameraPairs(unittest.TestCase):
    def test_carry_only_complete_pair_with_same_inputs_and_matching_bytes(self):
        from unittest.mock import MagicMock
        import city_panel

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            poses = root / "poses.json"
            poses.write_text(json.dumps({"one": {"street": [1] * 5, "100 m": [2] * 5}}))
            dest = root / "proof"
            dest.mkdir()
            (root / "shots").mkdir()
            server = MagicMock()
            server.__enter__.return_value.stdout = [
                "engine page on http://127.0.0.1:1234"
            ]
            visits = []

            def capture(args, **kwargs):
                self.assertNotIn("timeout", kwargs)
                name = args[args.index("--name") + 1]
                visits.append(name)
                for i in range(2):
                    (root / "shots" / f"{name}-{i}.png").write_bytes(
                        bytes([len(visits), i])
                    )
                return MagicMock(returncode=0, stdout="")

            with (
                patch.object(city_panel, "BAY", root),
                patch.object(city_panel, "POSES", poses),
                patch.object(city_panel.subprocess, "Popen", return_value=server),
                patch.object(city_panel.subprocess, "run", side_effect=capture),
            ):

                def shoot(key):
                    city_panel.shot(root, [{"place": "one", "square": "x"}], dest, key)

                shoot("first")
                shoot("first")
                self.assertEqual(len(visits), 1)
                (dest / "one-1.png").write_bytes(b"partial")
                shoot("first")
                shoot("second")
                self.assertEqual(len(visits), 3)
