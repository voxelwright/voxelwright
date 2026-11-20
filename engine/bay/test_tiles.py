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
