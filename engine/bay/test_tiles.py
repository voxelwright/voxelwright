"""Regression for a planet outline spanning the Grant Avenue tile boundary."""

import struct
import unittest
from shapely.geometry import box
from tiles import outline, outside_survey


class SurveySeam(unittest.TestCase):
    def test_first_vertex_outside_the_tile_does_not_add_a_second_house(self):
        verts = [(-2, 1, 3), (8, 1, 3), (8, 11, 3), (-2, 11, 7)]
        rows = [(0, 4, 1, 2, 3, 4)]
        tile = box(0, 0, 10, 10)
        self.assertEqual(list(outside_survey(rows, verts, box(-5,-5,20,20), tile)), [])
        [(part, style)] = outside_survey(rows, verts, box(-5,-5,4,20), tile)
        self.assertEqual(tuple(style), (1, 2, 3, 4))
        self.assertEqual(outline(part).area, 40)
        self.assertEqual(outline(part).intersection(box(-5,-5,4,20)).area, 0)
        for i, (x, _, flags) in enumerate(part):
            if x == part[(i+1)%len(part)][0] == 4:
                self.assertEqual(flags & 3, 0)



class Standing(unittest.TestCase):
    def test_only_span_ended_sensed_poles_stand(self):
        from street_furniture import DARK, SENSED_POLE, SPAN_WIRE, WOOD, encode, standing
        from full_run import standing_square

        lone = (100, 0, 50, 100, 130, 50, SENSED_POLE, WOOD)
        spanned = (200, 2, 50, 200, 120, 50, SENSED_POLE, WOOD)
        wire = (200, 116, 50, 250, 110, 50, SPAN_WIRE, DARK)
        photographed = (300, 0, 50, 300, 96, 50, 16, WOOD)
        segments = sorted([lone, spanned, wire, photographed])
        self.assertEqual(standing(segments), sorted([spanned, wire, photographed]))
        header = struct.pack("<16i", 0x31594142, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0)
        body = header + bytes(2 + 4)
        self.assertEqual(
            standing_square(body + encode(segments)),
            body + encode(sorted([spanned, wire, photographed])),
        )
        self.assertEqual(standing_square(body + encode([lone])), body)


class RoadFixtures(unittest.TestCase):
    def test_road_standing_lamp_hydrant_and_mid_road_lamp_are_cleaned(self):
        from collections import Counter
        import numpy as np
        from street_furniture import bake as bake_furniture

        class FakeSquare:
            def __init__(self):
                # 64 x 64 half-metre top grid covering [0, 320) cells; 33 x 33 1 m ground grid.
                self.h = [0x31594142, 1, 0, 0, 10, 33, 0, 0, 5, 64, 0, 0, 0, 0, 0, 0]
                self.ground = np.full((33, 33), 100, dtype="<i2")
                self.g2 = np.full((64, 64), 100, dtype="<i2")
                self.top = np.full((64, 64), 100, dtype="<i2")
                self.cls = np.zeros((64, 64), dtype="u1")  # ROAD everywhere
                # Pavement on x >= 220 (column >= 44)
                self.cls[:, 44:] = 1

        sq = FakeSquare()
        detail = {
            "fixtures": [
                # Lamp near curb on road (x=185, 3.5 m west of pavement) -> should snap onto pavement
                [1, "street_lamp", 185, 160],
                # Lamp deep in wide intersection (x=50, 17 m from pavement) -> should be dropped
                [2, "street_lamp", 50, 160],
                # Hydrant on road (x=195, 2.5 m west of pavement) -> should snap onto pavement
                [3, "hydrant", 195, 240],
            ],
            "wires": [],
        }
        graph = {
            "kerbs": [{"line": [[220, 0], [220, 320]]}],
            "roads": [{"line": [[110, 0], [110, 320]]}],
        }
        stats = Counter()
        segs = bake_furniture(sq, None, detail, None, [], graph, stats)
        # No vertical lamp mast or hydrant body may remain on ROAD (x < 220).
        lamp_masts = [s for s in segs if s[0] == s[3] and s[2] == s[5] and s[6] == 12 and s[4] - s[1] == 83]
        hyd_bodies = [s for s in segs if s[0] == s[3] and s[2] == s[5] and s[6] == 15 and s[4] - s[1] == 7]
        self.assertEqual(len(lamp_masts), 1)
        self.assertGreaterEqual(lamp_masts[0][0], 220)
        # Re-aimed arm points west (-x) back over the carriageway from the snapped mast.
        arms = [s for s in segs if s[6] == 5 and (s[0], s[1], s[2]) == (lamp_masts[0][0], lamp_masts[0][1] + 79, lamp_masts[0][2])]
        self.assertEqual(len(arms), 1)
        self.assertLess(arms[0][3], arms[0][0])
        self.assertEqual(len(hyd_bodies), 1)
        self.assertGreaterEqual(hyd_bodies[0][0], 220)
        self.assertEqual(stats["roadFixturesSnapped"], 2)
        self.assertEqual(stats["roadFixturesDropped"], 1)
