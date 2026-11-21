"""Regression for a planet outline spanning the Grant Avenue tile boundary."""

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

