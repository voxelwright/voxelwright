"""Accept a visually scored bake only when both fixed views hold at every place."""

import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).parent


def check(scores, previous):
    places = {
        r["place"] for r in json.loads((HERE / "neighbourhoods.json").read_text())
    }
    floors = json.loads((HERE / "panel-floors.json").read_text())
    for sheet in (scores, previous, floors):
        if set(sheet) != places:
            raise ValueError(
                f"panel names differ: {sorted(places.symmetric_difference(sheet))}"
            )
        for name, pair in sheet.items():
            if (
                not isinstance(pair, list)
                or len(pair) != 2
                or any(
                    type(n) not in (float, int)
                    or not math.isfinite(n)
                    or not 0 <= n <= 10
                    for n in pair
                )
            ):
                raise ValueError(f"{name} needs two finite scores in [0, 10]")
    drops = []
    for name, pair in scores.items():
        for i, view in enumerate(("street", "100 m")):
            floor = max(previous[name][i], floors[name][i])
            if pair[i] < floor:
                drops.append(f"{name} {view}: {pair[i]} < {floor}")
    if drops:
        raise ValueError("regression: " + ", ".join(drops))
    return len(places) * 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument(
        "previous", type=Path, help="accepted scores immediately before this pass"
    )
    args = parser.parse_args()
    try:
        print(
            check(
                *(json.loads(p.read_text()) for p in (args.candidate, args.previous))
            ),
            "views pass",
        )
    except ValueError as e:
        parser.exit(1, str(e) + "\n")
