"""Photographs as evidence: the trust test, the tile rows it writes, and the geometry of a face."""

import math
import struct
import unittest

import numpy as np

import sys

import evidence_tile
import facade_evidence as fe
from earth import pack

sys.path.insert(0, str(fe.Path(__file__).parents[1] / "landing" / "ina"))
import looks  # noqa: E402


def view(srgb, texels=200, clipped=0.0, weight=1.0):
    return fe.linear(np.array(srgb, "f4")), texels, clipped, weight


def tile(rows, verts, tail=b""):
    g = np.zeros((3, 3), "i2")
    t = np.full((4, 4), -32768, "i2")
    c = np.zeros((4, 4), "u1")
    return pack(0, 0, 2500, 10, g, 5, 0, 0, t, c, c, None, rows, verts) + tail


class Trust(unittest.TestCase):
    def test_two_views_that_agree_are_trusted_and_one_alone_is_not(self):
        cream = [214, 200, 170]
        colour, confidence, agreeing, trusted = fe.consensus([view(cream), view([210, 197, 168])])
        self.assertTrue(trusted)
        self.assertEqual(agreeing, 2)
        self.assertLess(np.abs(fe.encoded(colour) - cream).max(), 5)
        self.assertFalse(fe.consensus([view(cream)])[3])
        self.assertFalse(fe.consensus([view(cream), None])[3])

    def test_one_wall_a_little_darker_agrees_but_deep_shade_or_another_colour_does_not(self):
        # Lightness counts half: the same cream exposed darker still agrees (L 81 against 70). Deep shade (L 58) is a
        # second reading, not the same one, and a blue wall is another colour.
        self.assertTrue(fe.consensus([view([214, 200, 170]), view([180, 168, 143])])[3])
        self.assertFalse(fe.consensus([view([214, 200, 170]), view([150, 140, 122])])[3])
        self.assertFalse(fe.consensus([view([214, 200, 170]), view([120, 150, 200])])[3])

    def test_an_outlier_is_left_out_and_a_blown_view_says_nothing(self):
        colour, _, agreeing, trusted = fe.consensus([view([214, 200, 170]), view([212, 199, 171]), view([60, 140, 60], weight=0.4)])
        self.assertTrue(trusted)
        self.assertEqual(agreeing, 2)
        self.assertLess(np.abs(fe.encoded(colour) - [213, 200, 170]).max(), 4)
        # Two white views, each a third blown out: no colour at all.
        self.assertEqual(fe.consensus([view([250, 250, 250], clipped=0.33), view([248, 248, 248], clipped=0.4)])[:4], (None, 0.0, 0, False))
        # A majority must agree: two of five with little weight is not enough.
        views = [view([214, 200, 170], weight=0.2), view([212, 199, 171], weight=0.2), view([60, 140, 60]), view([200, 60, 60]), view([60, 60, 200])]
        self.assertFalse(fe.consensus(views)[3])


class Rows(unittest.TestCase):
    verts = [(100, 100, 3), (300, 100, 1), (300, 300, 1), (100, 300, 5)]
    key = "100,100;300,100;300,300;100,300"
    record = {
        "wall": {"palette": 57, "trusted": True},
        "material": {"drawn": 9, "confidence": 0.8},
        "windows": {"ratio": 0.42, "confidence": 0.7, "views": 3},
    }

    def rows(self, blob):
        h = struct.unpack_from("<16i", blob)
        at = evidence_tile.rows_at(h)
        return [struct.unpack_from("<6i", blob, at + 24 * n) for n in range(h[12])]

    def test_a_matched_row_takes_its_wall_and_material_but_not_its_glass_and_nothing_else_moves(self):
        trim = 9 | 1 << 8
        tail = b"SFPT" + struct.pack("<I", 0)
        blob = tile([(0, 4, 7 | 3 << 8, trim, 1234, 140)], self.verts, tail)
        stats = {}
        out = evidence_tile.apply(blob, {self.key: self.record}, stats)
        self.assertEqual(stats, {"rows": 1, "matched": 1, "written": 1})
        row = self.rows(out)[0]
        self.assertEqual(row[2], 9 | 57 << 8)
        self.assertEqual(row[3] & 0xFFFF, trim)
        self.assertEqual(row[3] >> 16, 1)
        self.assertEqual(len(out), len(blob))
        self.assertEqual(out[-8:], tail)
        changed = [i for i in range(len(blob)) if blob[i] != out[i]]
        at = 64 + 2 * 9 + 4 * 16
        self.assertTrue(all(at + 8 <= i < at + 16 for i in changed))

    def test_no_record_no_confidence_or_another_level_leaves_the_bytes(self):
        blob = tile([(0, 4, 7 | 3 << 8, 9 | 1 << 8, 1234, 140)], self.verts)
        self.assertEqual(evidence_tile.apply(blob, {}), blob)
        self.assertEqual(evidence_tile.apply(blob, {"0,0;1,1": self.record}), blob)
        doubtful = {"wall": {"palette": 57, "trusted": False}, "material": {"drawn": 9, "confidence": 0.3}, "windows": {"ratio": 0.4, "confidence": 0.2, "views": 1}}
        self.assertEqual(evidence_tile.apply(blob, {self.key: doubtful}), blob)
        coarse = bytearray(blob)
        coarse[12:16] = struct.pack("<i", 10000)
        self.assertEqual(evidence_tile.apply(bytes(coarse), {self.key: self.record}), bytes(coarse))

    def test_brick_without_a_trusted_colour_is_drawn_in_brick_own_colour(self):
        blob = tile([(0, 4, 9 | 3 << 8, 9 | 1 << 8, 1234, 140)], self.verts)
        rec = {"wall": {"palette": 57, "trusted": False}, "material": {"drawn": 8, "confidence": 0.7}}
        row = self.rows(evidence_tile.apply(blob, {self.key: rec}))[0]
        self.assertEqual((row[2], row[3] >> 16), (8, 1))


class Far(unittest.TestCase):
    def test_the_far_model_takes_a_trusted_colour_and_glass_but_not_over_a_known_building(self):
        table = [{"id": 1, "city": "A", "stands": 8.0}, {"id": 2, "city": "B", "stands": 60.0}, {"id": 3, "city": "C", "stands": 200.0, "name": "Transamerica Pyramid"}]
        plain = looks.walls(table, 3)
        measured = {
            "A": {"wall": {"trusted": True, "srgb": [200, 180, 90]}},
            "B": {"wall": {"trusted": False, "srgb": [1, 2, 3]}, "material": {"cls": "glass", "confidence": 0.7}},
            "C": {"wall": {"trusted": True, "srgb": [1, 2, 3]}, "material": {"cls": "glass", "confidence": 0.9}},
        }
        colour, style = looks.walls(table, 3, measured)
        self.assertEqual(colour[1], 200 << 16 | 180 << 8 | 90)
        self.assertEqual((colour[2], style[2]), (plain[0][2], looks.BY_NAME["glass"]))
        self.assertEqual((colour[3], style[3]), (plain[0][3], plain[1][3]))
        self.assertTrue((looks.walls(table, 3, {})[0] == plain[0]).all())


class Geometry(unittest.TestCase):
    def test_a_face_pixel_and_its_world_ray_agree(self):
        rot = fe.rotation(np.array([0.3, -1.2, 0.4]))
        pano = np.zeros((64, 128, 3), "u1")
        pano[..., 0] = np.arange(128)[None, :] * 2
        pano[..., 1] = np.arange(64)[:, None] * 4
        heading = math.radians(60)
        face = fe.cut(pano, rot, heading)
        world = np.array([[3.0, 2.0, 0.5], [2.5, 1.0, -0.4]])
        col, row = fe.onto(world, heading)
        cam = world @ rot.T
        u = ((np.arctan2(cam[:, 0], cam[:, 2]) / (2 * np.pi) + 0.5) % 1) * 128 - 0.5
        v = (0.5 + np.arctan2(cam[:, 1], np.hypot(cam[:, 0], cam[:, 2])) / np.pi) * 64 - 0.5
        got = face[np.rint(row).astype(int), np.rint(col).astype(int)]
        self.assertLess(np.abs(got[:, 0] - u * 2).max(), 6)
        self.assertLess(np.abs(got[:, 1] - v * 4).max(), 6)
        self.assertTrue(np.isnan(fe.onto(np.array([[-3.0, -2.0, 0.0]]), heading)[0]).all())

    def test_the_sun_over_san_francisco(self):
        # 2025-06-21 20:00 UTC is about 13:00 local: high in the south; 2025-12-21 at the same hour, low.
        az, el = fe.sun(-122.42, 37.77, 1750536000000)
        self.assertAlmostEqual(math.degrees(el), 75, delta=2)
        self.assertAlmostEqual(math.degrees(az), 180, delta=25)
        self.assertAlmostEqual(math.degrees(fe.sun(-122.42, 37.77, 1766347200000)[1]), 29, delta=2)


if __name__ == "__main__":
    unittest.main()
