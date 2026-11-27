"""Check the default 14:00 Ferry Building PNGs from landmark-shots.mjs.

    python engine/sf/check_ferry.py /path/to/landmark-shots
"""

from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from PIL import Image


def frame(folder, view):
    with Image.open(folder / f"ferry-building--{view}.png") as image:
        if image.size != (1280, 720):
            raise ValueError(f"{view} needs the fixed 1280 by 720 camera")
        return np.asarray(image.convert("RGB"), dtype=np.int16)


def arcade_openings(light):
    # Count runs of dark glazing at least a metre across, between pale piers.
    edges = np.diff((light < 75).astype(int), prepend=0, append=0)
    widths = np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)
    return np.count_nonzero((widths >= 6) & (widths <= 30))


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    folder = parser.parse_args().folder
    red, green, blue = frame(folder, "ferry-plaza")[440:530, 640:780].transpose(2, 0, 1)
    teal = ((green > red + 12) & (green >= blue - 6) & (green < 150)).mean()
    front = frame(folder, "front-elevation").mean(axis=2)
    wings = [arcade_openings(front[493, left:right]) for left, right in [(115, 480), (785, 1150)]]
    # Interior dial pixels, clear of the rim. Compare each hand to the
    # unmarked lower half so a blank dial or an entirely dark face fails.
    paper = front[304:307, 635:644].mean()
    minute = paper - front[291:296, 638:642].mean()
    hour = paper - front[296:298, 644:648].mean()
    print(f"Teal at entrance {teal:.1%}, wing openings {wings[0]}/{wings[1]}, "
          f"minute/hour contrast {minute:.0f}/{hour:.0f}")
    raise SystemExit(0 if teal < 0.08 and min(wings) >= 6 and min(minute, hour) > 65 else 1)
