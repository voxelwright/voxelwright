"""Regression tests for the upgraded multi-city pipeline (#60): Overture semantic tags, roof sculpting,
OSM semantic extraction, inland water preservation, and ordinary-house facade rules."""

import json
import sys
import unittest
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import earth
from coverage import landmark_extras
from full_run import plan
import street_detail
import mapped_water
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

    def test_split_shore_keeps_its_island_and_drops_incomplete_relations(self):
        nodes = dict(enumerate([(0, 0), (10, 0), (10, 10), (0, 10), (3, 3), (7, 3), (7, 7), (3, 7)]))
        ways = {("way", i): {"nodes": seq} for i, seq in enumerate(([0, 1, 2], [0, 3, 2], [4, 5, 6, 7, 4]))}
        ways["relation", 42] = {
            "tags": {"type": "multipolygon", "natural": "water", "water": "pond"},
            "members": [{"type": "way", "ref": i, "role": role} for i, role in enumerate(["outer", "outer", "inner"])],
        }
        raw = street_sources.extract_semantics(ways)["water"]
        self.assertEqual([m["role"] for m in raw[0]["members"]], ["outer", "outer", "inner"])
        records = mapped_water.areas(ways, nodes)
        self.assertEqual([r[0] for r in records], [-42])
        grid = mapped_water.mask(records, np.arange(11), np.arange(11))
        self.assertTrue(grid[2, 5])
        self.assertFalse(grid[5, 5])
        shoreline = mapped_water.mask(records, np.arange(12), np.arange(12), include_islands=True)
        self.assertTrue(shoreline[5, 5])
        self.assertFalse(shoreline[11, 5])
        self.assertEqual(mapped_water.areas({k: v for k, v in ways.items() if k != ("way", 2)}, nodes), [])

    def test_waterfowl_pond_and_moon_pool_survive_an_older_park_survey(self):
        park = mapped_water.for_square("545.7_4179.5", {})
        wildfowl = next(r for r in park if r[0] == -2792384)
        self.assertEqual(len(wildfowl[3]), 1)
        # Sample a mapped point in the water and another on its island, independently of the sampler.
        xs, zs = np.array([466868, 466973, 465338]), np.array([697562, 697440, 698181])
        grid = mapped_water.mask(park, xs, zs)
        self.assertTrue(grid[0, 0])
        self.assertFalse(grid[1, 1])
        self.assertTrue(grid[2, 2])
        self.assertFalse(mapped_water.for_square("543.7_4178.5", {}))
        # A new observation supersedes the retained geometry.
        updated = [-2792384, [(0, 0), (5, 0), (0, 5)], "pond", []]
        self.assertEqual([r for r in mapped_water.for_square("545.7_4179.5", {"osmWater": [updated]}) if r[0] == -2792384], [updated])

    def test_inland_water_stamped_onto_surface_grid(self):
        class FakeSquare:
            def __init__(self):
                self.h = [0] * 16
                self.h[4], self.h[5] = 10, 21
                self.h[8] = 5
                self.h[9] = 40
                self.h[10] = 0
                self.h[11] = 0
                self.ground = np.zeros((21, 21), dtype="<i2")
                self.cls = np.full((40, 40), 6, dtype=np.uint8)  # concrete YARD
                self.cls[10, 10] = 9  # pavement misclassified under a tree crown
                self.cls[0:4, :] = 0  # road along north edge

            window = street_detail.Square.window

        sq = FakeSquare()
        stats = Counter()
        # Pond polygon spanning cells 0..100 in x and 0..100 in z (pixels 0..20).
        detail = {"osmWater": [[1, [(0, 0), (100, 0), (100, 100), (0, 100)], "pond"]]}
        street_detail.inland_water(sq, detail, stats)
        self.assertGreater(stats["inlandWaterSamples"], 200)
        # Road preserved on north edge; interior yard turned into WATER (5).
        self.assertEqual(int(sq.cls[1, 10] & 7), 0)
        self.assertEqual(int(sq.cls[10, 10]), 5 | 8)
        # A body without a surveyed level keeps its ground.
        self.assertEqual(stats["levelledWaterSamples"], 0)

    def test_surface_level_takes_the_dense_floor_of_water_returns(self):
        rng = np.random.default_rng(60)
        water = 70.0 + rng.normal(0, 0.03, 400)
        lilies = 70.2 + rng.uniform(0, 3, 300)
        bank = np.full(100, 70.1)
        self.assertAlmostEqual(mapped_water.surface_level(np.r_[water, lilies], bank), 70.0, delta=0.03)
        # Too few returns, a floor wider than lidar noise, or water over its own bank: no level.
        self.assertIsNone(mapped_water.surface_level(water[:30], bank))
        self.assertIsNone(mapped_water.surface_level(70.0 + rng.uniform(0, 2.0, 400), bank))
        self.assertIsNone(mapped_water.surface_level(water, bank - 0.5))

    def test_surveyed_garden_levels_match_the_usgs_dem(self):
        # USGS EPQS (epqs.nationalmap.gov, 3DEP 1 m DEM) at a point inside each body, queried 2026-11-26.
        usgs = {-2792384: 71.71, 388991375: 70.78, 388991378: 68.49, 409163924: 74.79, 1062189335: 72.64, 1064989905: 67.84}
        records = {r[0]: r for r in mapped_water.garden_survey()["osmWater"]}
        for ident, metres in usgs.items():
            self.assertAlmostEqual(mapped_water.level_of(records[ident]), metres, delta=0.1)
        # A stream falls along its course and is never one level.
        self.assertIsNone(mapped_water.level_of(records[1062197644]))

    def test_surveyed_pond_ground_is_one_level_with_dry_island_and_path(self):
        """A DEM's TIN across Waterfowl Pond drew contours and a triangle in the reflection (#60)."""
        class FakeSquare:
            def __init__(self):
                self.h = [0] * 16
                self.h[4], self.h[5], self.h[8], self.h[9] = 10, 21, 5, 40
                self.cls = np.full((40, 40), 6, dtype=np.uint8)
                self.cls[:, 19:21] = 0  # a path across the pond at x = 95..105
                j, i = np.mgrid[0:21, 0:21]
                self.ground = (700 + i + j).astype("<i2")  # a sloped TIN from 70.0 m up to 74.0 m

        sq, stats = FakeSquare(), Counter()
        before = sq.ground.copy()
        island = [(140, 140), (180, 140), (180, 180), (140, 180)]
        pond = [-2792384, [(0, 0), (200, 0), (200, 200), (0, 200)], "pond", [island]]
        street_detail.inland_water(sq, {"osmWater": [pond]}, stats)
        level = round((71.72 - 1.0) * 10)
        self.assertGreater(stats["levelledWaterSamples"], 200)
        # The height the renderer gives each water cell: between the four samples round its centre (core bay.rs).
        def heights(ground):
            j, i = np.nonzero((sq.cls & 7) == 5)
            fx, fz = (i * 5 + 2.5) / 10, (j * 5 + 2.5) / 10
            i0, j0, u, v = fx.astype(int), fz.astype(int), fx % 1, fz % 1
            # Water beside the path meets the path's own height.
            off = (i0 != 10) & (i0 + 1 != 10)
            i0, j0, u, v = i0[off], j0[off], u[off], v[off]
            g = lambda a, b: ground[j0 + b, i0 + a].astype(float)
            return np.floor((g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v + 0.5)
        self.assertEqual(set(np.unique(heights(sq.ground))), {level})
        self.assertGreater(len(np.unique(heights(before))), 10)  # the old ground drew contours across the water
        # The path across the water and the island's crown keep their heights.
        np.testing.assert_array_equal(sq.ground[:, 10], before[:, 10])
        np.testing.assert_array_equal(sq.ground[16:18, 16:18], before[16:18, 16:18])


if __name__ == "__main__":
    unittest.main()
