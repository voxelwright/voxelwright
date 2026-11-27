"""A better mean cannot promote a release that regresses one pinned camera."""

import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from panel_gate import HERE

sys.path.insert(0, str(HERE.parent / "sf"))
from release import encode, generate, restock


class PanelPromotion(unittest.TestCase):
    def test_landing_restock_leaves_shared_far_library_intact(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / "shared" / "landing" / "1_2.far"
            original.parent.mkdir(parents=True)
            original.write_bytes(b"old faces")
            manifest = encode({"far": {"tiles": {"1_2": [None, None, None]}}})
            base = hashlib.sha256(manifest).hexdigest()
            old = root / "releases" / base
            old.mkdir(parents=True)
            (old / "manifest.json").write_bytes(manifest)
            (old / "far").symlink_to("../../shared")
            cut = root / "cut"
            path = "far/landing/1_2.far"
            (cut / path).parent.mkdir(parents=True)
            body = b"new faces"
            (cut / path).write_bytes(body)
            row = dict(path=path, sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
            (cut / "landing.json").write_bytes(encode(dict(version=1, eye=[0, 0, 0], tiles={"1_2": row})))
            digest = restock(root, landing=cut, base=base)
            self.assertEqual((root / "releases" / digest / path).read_bytes(), body)
            self.assertEqual((old / path).read_bytes(), b"old faces")

    def test_far_restock_carries_the_landmarks_only_tiles(self):
        # Without them page/far.ts hands the Golden Gate's Marin tiles over and their ground is drawn as sea (#60).
        with TemporaryDirectory() as folder:
            root = Path(folder)
            far = {"version": 1, "size": 5000, "bands": [4, 1, 0], "lods": [16],
                   "tiles": {k: [None, None, None] for k in ("91_125", "91_126")},
                   "landmarks": ["91_126"]}
            manifest = encode({"far": {**far, "credit": "original survey"}, "credits": ["street data", "original survey"]})
            base = hashlib.sha256(manifest).hexdigest()
            old = root / "releases" / base
            old.mkdir(parents=True)
            (old / "manifest.json").write_bytes(manifest)
            packed = root / "packed"
            path = "far/0/91_125.far"
            (packed / path).parent.mkdir(parents=True)
            body = b"bridge faces"
            (packed / path).write_bytes(body)
            row = dict(path=path, sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
            (packed / "far.json").write_bytes(encode({**far, "tiles": {"91_125": [row, None, None]}, "landmarks": ["91_125"], "credit": "original survey; OSM inland water"}))
            digest = restock(root, far=packed / "far.json", base=base)
            staged = json.loads((root / "releases" / digest / "manifest.json").read_text())
            self.assertEqual(staged["far"]["landmarks"], ["91_125", "91_126"])
            self.assertEqual(staged["far"]["tiles"]["91_125"][0], row)
            self.assertEqual(staged["credits"], ["street data", "original survey; OSM inland water"])
            self.assertEqual(staged["far"]["credit"], "original survey; OSM inland water")
            # Repacking identical old bands alongside a new key cannot turn a known bridge into surveyed ground.
            legacy = {k: v for k, v in far.items() if k != "landmarks"}
            legacy["credit"] = "older survey"
            (packed / "far.json").write_bytes(encode({**legacy, "tiles": {"91_125": [row, None, None]}}))
            same = restock(root, far=packed / "far.json", base=digest)
            kept = json.loads((root / "releases" / same / "manifest.json").read_text())
            self.assertEqual(kept["far"]["landmarks"], ["91_125", "91_126"])
            # A later survey replaces the bridge-only tile with real ground. The other key was never restocked.
            (packed / path).write_bytes(b"survey ground")
            row.update(sha256=hashlib.sha256(b"survey ground").hexdigest(), bytes=len(b"survey ground"))
            grounded = {k: v for k, v in far.items() if k != "landmarks"}
            (packed / "far.json").write_bytes(encode({**grounded, "tiles": {"91_125": [row, None, None]}}))
            next_digest = restock(root, far=packed / "far.json", base=digest)
            changed = json.loads((root / "releases" / next_digest / "manifest.json").read_text())
            self.assertEqual(changed["far"]["landmarks"], ["91_126"])

    def test_partial_restock_replaces_only_the_supplied_ground_coverage(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            spec = dict(version=1, size=5000, bands=[4, 1, 0], lods=[16])
            keys = {k: [None, None, None] for k in ("91_125", "97_131", "98_131")}
            path = "far/0/91_125.far"
            body = b"packed faces"
            (root / path).parent.mkdir(parents=True)
            (root / path).write_bytes(body)
            keys["91_125"][0] = dict(path=path, bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
            far = {**spec, "tiles": keys, "ground": ["97_131", "98_131"], "landmarks": ["91_125"]}
            manifest = encode({"far": far})
            base = hashlib.sha256(manifest).hexdigest()
            old = root / "releases" / base
            old.mkdir(parents=True)
            (old / "manifest.json").write_bytes(manifest)
            incoming = root / "far.json"
            replacement = {**spec, "tiles": {k: keys[k] for k in ("91_125", "97_131")}}
            incoming.write_bytes(encode({**replacement, "ground": ["91_125"]}))
            digest = restock(root, far=incoming, base=base)
            result = json.loads((root / "releases" / digest / "manifest.json").read_bytes())["far"]
            self.assertEqual(result["ground"], ["91_125", "98_131"])
            self.assertNotIn("91_125", result.get("landmarks", []))
            incoming.write_bytes(encode({**replacement, "ground": ["90_125"]}))
            with self.assertRaisesRegex(ValueError, "ground"):
                restock(root, far=incoming, base=base)

    def test_one_lower_view_or_an_unscored_core_preserves_the_pin(self):
        scores = json.loads((HERE / "panel-floors.json").read_text())
        with TemporaryDirectory() as folder:
            root = Path(folder)
            tiles = root / "packs/tiles"
            tiles.mkdir(parents=True)
            (tiles / "index.json").write_text(
                json.dumps(dict(levels=[], tiles=[], sea=[], squares=[]))
            )
            (root / "state.json").write_text('{"done":{}}')
            core = root / "core.wasm"
            core.write_bytes(b"test renderer")
            out = root / "sf"
            digest = generate(root, out)
            pointer = out / "current.json"
            self.assertFalse(pointer.exists())
            panel = root / "panel.json"
            data = dict(
                release=digest,
                previousRelease=None,
                scores=scores,
                coreSha256=hashlib.sha256(core.read_bytes()).hexdigest(),
                panelSpecSha256=hashlib.sha256(
                    (HERE / "neighbourhoods.json").read_bytes()
                ).hexdigest(),
            )
            panel.write_text(json.dumps(data))
            generate(root, out, panel=panel, core=core)
            original = pointer.read_bytes()
            data["previousRelease"] = digest
            for view in (0, 1):
                with self.subTest(view=view):
                    old = scores["Dogpatch"][view]
                    scores["Dogpatch"][view] = old - 0.5
                    panel.write_text(json.dumps(data))
                    with self.assertRaisesRegex(ValueError, "Dogpatch"):
                        generate(root, out, panel=panel, core=core)
                    self.assertEqual(pointer.read_bytes(), original)
                    scores["Dogpatch"][view] = old
            panel.write_text(json.dumps(data))
            core.write_bytes(b"new renderer")
            with self.assertRaisesRegex(ValueError, "coreSha256"):
                generate(root, out, panel=panel, core=core)
            self.assertEqual(pointer.read_bytes(), original)


class PixelGate(unittest.TestCase):
    """Synthetic pictures only: no reference photograph enters the repository."""

    def street(self, folder, name, posts=0):
        import numpy as np
        from PIL import Image

        rgb = np.zeros((540, 960, 3), np.uint8)
        rgb[:300] = (90, 140, 210)  # sky
        rgb[300:] = (120, 115, 105)  # walls and street
        for k in range(posts):
            x = 80 + 110 * k
            rgb[120:300, x : x + 6] = (150, 140, 120)
        path = Path(folder) / name
        Image.fromarray(rgb).save(path)
        return path

    def inspect(self, folder, render, photo, view=0, reply=None):
        import panel_gate
        import render_checks

        refs = Path(folder) / "refs"
        refs.mkdir(exist_ok=True)
        place = "Nob Hill"
        (refs / (place + ("" if view == 0 else " 100 m") + ".jpg")).write_bytes(photo.read_bytes())
        with patch.object(panel_gate, "REFERENCES", refs), patch.object(render_checks.subprocess, "run", side_effect=reply or OSError("no model here")):
            return panel_gate.inspect(place, view, render, Path(folder) / "cache", judge=reply is not None)

    def test_pillars_with_no_counterpart_fail_and_a_clean_street_passes(self):
        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            bad = self.inspect(folder, self.street(folder, "posts.png", posts=6), photo)
            self.assertFalse(bad["passed"])
            self.assertEqual(bad["checks"]["pillars"]["excess"], 6)
            good = self.inspect(folder, self.street(folder, "clean.png"), photo)
            self.assertTrue(good["passed"], good["defects"])

    def test_a_street_shaded_navy_fails_and_one_shaded_grey_passes(self):
        import numpy as np
        from PIL import Image

        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            for colour, passes in (((45, 58, 92), False), ((62, 64, 66), True)):
                with self.subTest(colour=colour):
                    rgb = np.asarray(Image.open(self.street(folder, "shade.png"))).copy()
                    rgb[320:420, 100:860] = colour  # a shadow across the road
                    path = Path(folder) / f"shade-{passes}.png"
                    Image.fromarray(rgb).save(path)
                    record = self.inspect(folder, path, photo)
                    self.assertEqual(record["passed"], passes, record["defects"])
                    self.assertEqual(record["checks"]["shade"]["render"], colour[2] - colour[0])

    def test_a_judge_naming_battlements_twice_fails_the_view(self):
        from types import SimpleNamespace

        answer = json.dumps(dict(result=json.dumps(dict(defects=[dict(name="battlements", clear=True, where="roofs")], notes="")), is_error=False))
        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            record = self.inspect(folder, self.street(folder, "clean.png"), photo,
                                  reply=lambda *a, **k: SimpleNamespace(stdout=answer, stderr="", returncode=0))
            self.assertEqual(record["defects"], ["judge: battlements (roofs)"])

    def test_a_judge_that_cannot_answer_fails_the_view(self):
        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            record = self.inspect(folder, self.street(folder, "clean.png"), photo, reply=OSError("offline"))
            self.assertFalse(record["passed"])
            self.assertIn("judge", record["defects"][0])

    def test_a_judge_naming_a_clear_defect_fails_the_view(self):
        from types import SimpleNamespace

        answer = json.dumps(dict(result=json.dumps(dict(defects=[dict(name="banding", clear=True, where="left walls")], notes="")), is_error=False))
        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            record = self.inspect(folder, self.street(folder, "clean.png"), photo,
                                  reply=lambda *a, **k: SimpleNamespace(stdout=answer, stderr="", returncode=0))
            self.assertFalse(record["passed"])
            self.assertIn("banding", record["defects"][0])

    def test_a_defect_named_once_and_not_again_does_not_fail_the_view(self):
        from types import SimpleNamespace

        said = [dict(defects=[dict(name="pillars", clear=True, where="left")], notes=""), dict(defects=[], notes="")]
        answers = iter(json.dumps(dict(result=json.dumps(x), is_error=False)) for x in said)
        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            record = self.inspect(folder, self.street(folder, "clean.png"), photo,
                                  reply=lambda *a, **k: SimpleNamespace(stdout=next(answers), stderr="", returncode=0))
            self.assertTrue(record["passed"], record["defects"])
            self.assertEqual(len(record["judge"]), 2)

    def test_a_view_from_100_m_says_its_street_checks_do_not_apply(self):
        with TemporaryDirectory() as folder:
            photo = self.street(folder, "photo.png")
            record = self.inspect(folder, self.street(folder, "posts.png", posts=6), photo, view=1)
            self.assertTrue(all(isinstance(v, str) and "not applicable" in v for v in record["checks"].values()))

    def test_a_score_floor_holds_only_where_the_earlier_render_passed(self):
        from panel_gate import check

        floors = json.loads((HERE / "panel-floors.json").read_text())
        lower = {k: [max(v[0] - 1, 0), v[1]] for k, v in floors.items()}
        self.assertEqual(check(lower, floors, judged=set()), 32)
        with self.assertRaisesRegex(ValueError, "Dogpatch street"):
            check(lower, floors, judged={("Dogpatch", 0)})
        with self.assertRaisesRegex(ValueError, "regression"):
            check(lower, floors)


class Acceptance(unittest.TestCase):
    """accept() with the gate stubbed: scores optional, carried, and a floor that survives carrying."""

    def test_scored_then_carried_then_lower_is_refused_and_receipts_verify(self):
        import city_panel
        from full_run import save

        floors = json.loads((HERE / "panel-floors.json").read_text())
        with TemporaryDirectory() as folder:
            root, pilot = Path(folder) / "root", Path(folder) / "pilot"
            (root / "pending/shots").mkdir(parents=True)
            pilot.mkdir()
            (pilot / "final-scores.json").write_text(json.dumps(floors))
            views = {}
            for place in floors:
                pair = []
                for i in (0, 1):
                    shot = root / "pending/shots" / f"{place}-{i}.png"
                    shot.write_bytes(f"{place} {i}".encode())
                    pair.append(hashlib.sha256(shot.read_bytes()).hexdigest())
                views[place] = pair
            passed = lambda shots, cache: {p: [dict(passed=True), dict(passed=True)] for p in shots}

            def stage(previous):
                e = dict(previous=previous, renderer="r", members={}, seeds={}, views=views, tileFiles={})
                batch = city_panel.fingerprint(e)
                save(root / "pending/evidence.json", dict(e, batch=batch))
                return batch

            with (
                patch.object(city_panel, "PILOT", pilot),
                patch.object(city_panel, "renderer", lambda: "r"),
                patch.object(city_panel, "gate", passed),
                patch.object(city_panel, "bundles", lambda root, members: []),
                patch.object(city_panel, "finish", lambda root, batch: None),
                patch("paint_batch_tiles.measure", lambda *a: {}),
            ):
                a = stage(None)
                city_panel.accept(root, a, floors)
                b = stage(a)
                city_panel.accept(root, b, None)
                receipt = json.loads((root / "accepted" / (b + ".json")).read_text())
                self.assertTrue(receipt["scoresCarried"])
                self.assertEqual(receipt["scores"], floors)
                self.assertEqual(len(receipt["measured"]), 32)
                for batch in (a, b):
                    city_panel.accepted_faces(root / "accepted" / (batch + ".json"))
                c = stage(b)
                lower = {k: [v[0] - 0.5, v[1]] for k, v in floors.items()}
                with self.assertRaisesRegex(ValueError, "regression"):
                    city_panel.accept(root, c, lower)
