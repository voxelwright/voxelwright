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
