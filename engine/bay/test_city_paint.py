"""Regression checks for persisted request debits, tile inheritance and the park exclusion."""

import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from email.message import Message
import io
from urllib.error import HTTPError

from paint_cameras import GAP, TILES_A_DAY, Requests
from paint_tile import EYE, without_eye_trees


def requests_at(root, clock):
    req = Requests.__new__(Requests)
    req.root, req.maximum, req.token = root, 160, "t"
    req.count = req.api = req.bytes = 0
    return req


class Reserve(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.clock = [5000.0]

        def wait(secs):
            self.clock[0] += secs

        self.patches = [
            patch("paint_cameras.time.time", side_effect=lambda: self.clock[0]),
            patch("paint_cameras.time.sleep", side_effect=wait),
            patch("paint_cameras.shutil.disk_usage"),
        ]
        for p in self.patches:
            p.start().return_value.free = 30 * 2**30

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def state(self):
        return json.loads((self.root / "allowance.json").read_text())

    def test_one_clock_paces_every_worker_and_keeps_old_debits(self):
        # The hourly pacer's history and retry deadline survive the switch.
        (self.root / "allowance.json").write_text(
            json.dumps(dict(requests=[4000.0] * 3, next=5100, total=200, api=91))
        )
        a, b = requests_at(self.root, self.clock), requests_at(self.root, self.clock)
        a.reserve(False)
        first = self.clock[0]
        b.reserve(True, tile=True)
        self.assertEqual(first, 5100)
        self.assertGreaterEqual(self.clock[0] - first, GAP)
        state = self.state()
        self.assertEqual((state["total"], state["api"]), (202, 92))
        self.assertEqual(len(state["tiles"]), 4)
        self.assertNotIn("requests", state)

    def test_tiles_stop_at_their_daily_share(self):
        (self.root / "allowance.json").write_text(
            json.dumps(dict(tiles=[4000.0 + i for i in range(TILES_A_DAY)]))
        )
        req = requests_at(self.root, self.clock)
        req.reserve(True)
        self.assertEqual(self.clock[0], 5000)
        req.reserve(True, tile=True)
        self.assertGreaterEqual(self.clock[0], 4000 + 86400)

    def reply(self, code, body=b"", headers=None):
        return HTTPError("u", code, "m", Message() if headers is None else headers, io.BytesIO(body))

    def test_limit_cooldown_persists_for_a_new_worker(self):
        req = requests_at(self.root, self.clock)
        limit = json.dumps(
            {"error": {"message": "Application request limit reached", "code": 4}}
        ).encode()
        with patch("paint_cameras.urlopen", side_effect=self.reply(400, limit)):
            with self.assertRaises(RuntimeError):
                req.get("https://graph.mapillary.com/1")
        self.assertGreaterEqual(self.state()["next"], 5000 + 600)
        requests_at(self.root, self.clock).reserve(True)
        self.assertGreaterEqual(self.clock[0], 5600)

    def test_isolated_errors_back_off_briefly_then_escalate(self):
        req = requests_at(self.root, self.clock)
        with patch("paint_cameras.urlopen", side_effect=self.reply(403)):
            with self.assertRaises(RuntimeError):
                req.get("https://scontent.example/x.jpg", False)
            self.assertEqual(self.state()["next"] - self.clock[0], 15)
            with self.assertRaises(RuntimeError):
                req.get("https://scontent.example/x.jpg", False)
        self.assertEqual(self.state()["next"] - self.clock[0], 30)

    def test_workers_failing_together_count_once(self):
        a, b = requests_at(self.root, self.clock), requests_at(self.root, self.clock)
        a.strike("network")
        b.strike("network")
        self.assertEqual(len(self.state()["strikes"]), 1)
        self.assertEqual(self.state()["next"] - self.clock[0], 15)

    def test_missing_image_is_recorded_without_a_cooldown(self):
        req = requests_at(self.root, self.clock)
        with patch("paint_cameras.urlopen", side_effect=self.reply(404)):
            self.assertEqual(req.get("https://graph.mapillary.com/1"), b"{}")
        self.assertLess(self.state()["next"] - self.clock[0], 1)


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
