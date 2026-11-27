"""Regression tests for the upgraded multi-city pipeline (#60): Overture semantic tags, roof sculpting,
OSM semantic extraction, inland water preservation, and ordinary-house facade rules."""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import earth
from coverage import landmark_extras
from full_run import plan
import street_detail
import street_sources


class TestMultiCityProcedure(unittest.TestCase):
    def test_city_plan_covers_landmark_walkups(self):
        survey = json.loads(Path(__file__).with_name("sf-squares.json").read_text())
        self.assertEqual(survey["landmarkExtras"], landmark_extras(survey))
        city = plan(survey["lidar"], survey["planet"], True, survey["landmarkExtras"])
        # At the Marin end of the Golden Gate Bridge, beyond the county's lidar squares.
        self.assertIn((0, 182, 250), city)
        self.assertNotIn((0, 182, 250), plan([], [], False, survey["landmarkExtras"]))

    def test_earth_parses_overture_materials_and_colors(self):
        # Explicit hex & named colours map into valid engine palette indices (1..255).
        red_idx = earth.parse_color_index("#b44638")
        cream_idx = earth.parse_color_index("cream")
        self.assertIsNotNone(red_idx)
        self.assertIsNotNone(cream_idx)
        self.assertNotEqual(red_idx, cream_idx)
        self.assertIsNone(earth.parse_color_index("not-a-color"))

        # Explicit facade_material overrides random CRC32 fallback.
        wall, _, _ = earth.style(7, home=False, tall=18, props={"facade_material": "glass", "facade_color": "#6495ed"})
        self.assertEqual(wall & 15, earth.GLASS)
        wall_brick, _, _ = earth.style(7, home=True, tall=10, props={"facade_material": "brick", "facade_color": "terracotta"})
        self.assertEqual(wall_brick & 15, earth.BRICK)
        wall_gh, _, _ = earth.style(11, home=False, tall=14, props={"class": "conservatory"})
        self.assertEqual(wall_gh & 15, earth.GLASS)
        # Backwards-compatible 3-argument signature still works.
        w3, t3, s3 = earth.style(42, True, 9.0)
        self.assertGreater(w3, 0)
        self.assertGreater(t3, 0)
        self.assertGreater(s3, 0)

    def test_earth_sculpts_pitched_and_domed_roofs(self):
        mask = np.ones((21, 21), bool)
        dome = earth.sculpt_roof("dome", mask, base=100, tall=16.0, roof_h=6.0)
        self.assertGreater(int(dome[10, 10]), int(dome[0, 10]) + 40)
        gable = earth.sculpt_roof("gabled", mask, base=100, tall=12.0, roof_h=4.0)
        self.assertGreater(int(gable[10, 10]), int(gable[0, 10]) + 25)
        self.assertEqual(int(gable[10, 2]), int(gable[10, 18]))

    def test_osm_semantics_retained_without_extra_requests(self):
        items = {
            ("way", 101): {
                "type": "way",
                "id": 101,
                "nodes": [1, 2, 3, 4, 1],
                "tags": {
                    "building": "museum",
                    "name": "California Academy of Sciences",
                    "building:material": "glass",
                    "roof:material": "grass",
                },
            },
            ("way", 202): {
                "type": "way",
                "id": 202,
                "nodes": [5, 6, 7, 8, 5],
                "tags": {"natural": "water", "water": "pond", "name": "Koi Pond"},
            },
            ("way", 303): {
                "type": "way",
                "id": 303,
                "nodes": [9, 10, 11, 12, 9],
                "tags": {"leisure": "garden", "name": "Japanese Tea Garden"},
            },
        }
        sem = street_sources.extract_semantics(items)
        self.assertIn("101", sem["buildings"])
        self.assertEqual(sem["buildings"]["101"]["roof:material"], "grass")
        self.assertEqual(len(sem["water"]), 1)
        self.assertEqual(len(sem["gardens"]), 1)

    def test_inland_water_stamped_onto_surface_grid(self):
        class FakeSquare:
            def __init__(self):
                self.h = [0] * 16
                self.h[9] = 40
                self.h[10] = 0
                self.h[11] = 0
                self.cls = np.full((40, 40), 6, dtype=np.uint8)  # concrete YARD
                self.cls[0:4, :] = 0  # road along north edge

            window = street_detail.Square.window

        sq = FakeSquare()
        stats = {"inlandWaterSamples": 0}
        # Pond polygon spanning cells 0..100 in x and 0..100 in z (pixels 0..20).
        detail = {"osmWater": [[1, [(0, 0), (100, 0), (100, 100), (0, 100)], "pond"]]}
        street_detail.inland_water(sq, detail, stats)
        self.assertGreater(stats["inlandWaterSamples"], 200)
        # Road preserved on north edge; interior yard turned into WATER (5).
        self.assertEqual(int(sq.cls[1, 10] & 7), 0)
        self.assertEqual(int(sq.cls[10, 10] & 7), 5)


if __name__ == "__main__":
    unittest.main()
