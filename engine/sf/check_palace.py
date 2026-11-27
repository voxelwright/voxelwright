"""Check the sightline through the Palace rotunda from its east-bank camera."""

import json
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from PIL import Image


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    shot = parser.parse_args().folder / "palace-of-fine-arts--east-bank"
    info = json.loads(shot.with_suffix(".json").read_text())
    views = json.loads(Path(__file__).with_name("landmark-views.json").read_text())
    if info["camera"] != views["Palace of Fine Arts"]["east bank"] or abs(info["fov"] - 48) > 1e-5:
        raise ValueError("Use the registered east-bank camera")
    with Image.open(shot.with_suffix(".png")) as image:
        if image.size != (1280, 720):
            raise ValueError("Use the full 1280 by 720 frame")
        red, green, blue = np.asarray(image.convert("RGB"), dtype=np.int16).transpose(2, 0, 1)

    # These rays pass through an arch and above the far roof. The piers
    # either side must still obstruct the sky at the same elevation.
    sky = (blue - red > 65) & (green > 140) & (blue > 185)
    opening = sky[374:420, 618:647].mean()
    left = sky[374:420, 548:587].mean()
    right = sky[374:420, 667:702].mean()
    print(f"Sky through rotunda arch {opening:.1%}, left pier {left:.1%}, right pier {right:.1%}")
    raise SystemExit(0 if opening > 0.75 and max(left, right) < 0.1 else 1)
