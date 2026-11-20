"""A better mean cannot promote a release that regresses one pinned camera."""

import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

from panel_gate import HERE

sys.path.insert(0, str(HERE.parent / "sf"))
from release import generate


class PanelPromotion(unittest.TestCase):
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
