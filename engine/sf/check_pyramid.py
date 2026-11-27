"""Check the sunlit aluminium spire and quartz body in the registered 14:00 skyline view."""

import json
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from PIL import Image


def lightness(pixels):
    srgb = pixels / 255
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    y = linear @ [0.2126, 0.7152, 0.0722]
    return float(np.median(np.where(y > (6 / 29) ** 3, 116 * np.cbrt(y) - 16, (29 / 3) ** 3 * y)))


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    shot = parser.parse_args().folder / "transamerica-pyramid--skyline"
    info = json.loads(shot.with_suffix(".json").read_text())
    if info["camera"] != [53180, 210, 66140, -135.1, -3.7] or float(info["hour"]) != 14 or abs(info["fov"] - 65) > 1e-5:
        raise ValueError("Use the registered 14:00 skyline camera")
    with Image.open(shot.with_suffix(".png")) as image:
        if image.size != (1280, 720):
            raise ValueError("Use the full 1280 by 720 frame")
        rgb = np.asarray(image.convert("RGB"))
    # Rays through these quartz and spire pixels meet lidar footprint 4243.
    # The shaded wall on the neighboring high-rise is a local exposure reference.
    spire = lightness(rgb[304:323, 638:642])
    quartz = lightness(rgb[np.ix_([335, 348, 373], [637, 640, 643])])
    wall = lightness(rgb[375:412, 563:569])
    print(f"Skyline lightness L*: spire {spire:.1f}, quartz {quartz:.1f}, neighboring wall {wall:.1f}")
    raise SystemExit(0 if spire > quartz + 5 and quartz > wall + 5 else 1)
