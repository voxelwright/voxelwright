"""Unit tests for open-data storefront classification, facade snapping and plaza extraction (#93)."""

import math
import unittest

import places_sources as ps


class PlacesSourcesTests(unittest.TestCase):
    def test_classify_overture_keeps_neighborhood_storefronts(self):
        self.assertEqual(ps.classify_overture("pizza_restaurant", ["eat_and_drink"], "restaurant", "Haystack Pizza"), "pizza")
        self.assertEqual(ps.classify_overture("burger_restaurant", ["eat_and_drink"], "restaurant", "Hi-Way Burger"), "burger")
        self.assertEqual(ps.classify_overture("ice_cream_shop", ["eat_and_drink"], "dessert", "Banán"), "ice_cream")
        self.assertEqual(ps.classify_overture("coffee_shop", ["eat_and_drink"], "cafe", "Martha & Bros"), "coffee")
        self.assertEqual(ps.classify_overture("book_store", ["shopping"], "retail", "Noe Valley Books"), "books")
        self.assertEqual(ps.classify_overture("florist", ["shopping"], "retail", "French Tulip"), "florist")
        self.assertEqual(ps.classify_overture("supermarket", ["shopping"], "grocery", "Whole Foods Market"), "supermarket")

    def test_classify_overture_filters_offices_and_clinics(self):
        self.assertIsNone(ps.classify_overture("dental_clinic", ["health_care"], "dental_clinic", "Dr. Smith DDS"))
        self.assertIsNone(ps.classify_overture("real_estate_agent", ["services_and_business"], "real_estate_service", "Vivre Real Estate"))
        self.assertIsNone(ps.classify_overture("food_delivery_service", ["lifestyle_services"], "food_service", "Ghost Delivery"))
        self.assertIsNone(ps.classify_overture("lawyer", ["professional_services"], "legal", "Acme Law"))

    def test_snap_poi_to_street_facing_facade(self):
        # 20 m x 10 m building from x=0..20, z=10..20; street runs east-west at z=0
        ring = [(0.0, 10.0), (20.0, 10.0), (20.0, 20.0), (0.0, 20.0)]
        bldgs = [{"ring": ring, "bbox": (0.0, 10.0, 20.0, 20.0), "cx": 10.0, "cz": 15.0, "r": 10.0, "h": 9.5}]
        bldg_grid = {(0, 0): [0]}
        roads = [(-10.0, 0.0, 30.0, 0.0, "24th Street", 2)]
        road_grid = {(0, 0): [0], (-1, 0): [0]}
        snap = ps.snap_poi_to_facade(10.0, 14.0, bldgs, bldg_grid, roads, road_grid, 50.0)
        self.assertIsNotNone(snap)
        # Must snap to the north wall (z=10) facing the street at z=0 with normal (0, -1)!
        self.assertAlmostEqual(snap["z"], 10.0, places=1)
        self.assertAlmostEqual(snap["nx"], 0.0, places=2)
        self.assertAlmostEqual(snap["nz"], -1.0, places=2)
        self.assertGreater(snap["sw"], 3.0)
        self.assertEqual(snap["st"], "24th Street")

    def test_fuse_storefronts_deduplicates_osm_and_overture(self):
        ring = [(0.0, 10.0), (20.0, 10.0), (20.0, 20.0), (0.0, 20.0)]
        bldgs = [{"ring": ring, "bbox": (0.0, 10.0, 20.0, 20.0), "cx": 10.0, "cz": 15.0, "r": 10.0, "h": 9.0}]
        bldg_grid = {(0, 0): [0]}
        roads = [(-10.0, 0.0, 30.0, 0.0, "24th Street", 2)]
        road_grid = {(0, 0): [0], (-1, 0): [0]}
        lon1, lat1 = ps.FROM_UTM.transform(500_005.0, 4_249_986.0)
        lon2, lat2 = ps.FROM_UTM.transform(500_014.0, 4_249_986.0)
        osm_pois = [{"type": "node", "lon": lon1, "lat": lat1, "tags": {"name": "Haystack Pizza", "amenity": "restaurant", "cuisine": "pizza", "outdoor_seating": "yes"}}]
        overture = [
            {"src": "ov", "name": "Haystack Pizza", "brand": "", "cat": "pizza", "conf": 0.9, "addr": "3881 24th St", "lon": lon1, "lat": lat1},
            {"src": "ov", "name": "Hi-Way Burger", "brand": "", "cat": "burger", "conf": 0.92, "addr": "3853 24th St", "lon": lon2, "lat": lat2},
        ]
        kept = ps.fuse_storefronts(overture, osm_pois, bldgs, bldg_grid, roads, road_grid, 50.0)
        names = [k["n"] for k in kept]
        self.assertEqual(names.count("Haystack Pizza"), 1)
        self.assertIn("Hi-Way Burger", names)
        haystack = next(k for k in kept if k["n"] == "Haystack Pizza")
        self.assertEqual(haystack.get("out"), 1)


if __name__ == "__main__":
    unittest.main()
