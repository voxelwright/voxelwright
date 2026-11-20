"""The 10 km sheets published for USGS project CA_SanFrancisco_B23."""

from pathlib import Path

import numpy as np
import tifffile

PAD = 16


def sheets(e, n, size):
    for x in range(int((e - PAD) // 10000), int((e + size + PAD) // 10000) + 1):
        for y in range(int((n - PAD) // 10000) + 1, int((n + size + PAD) // 10000) + 2):
            if x in (54, 55) and y in (418, 419):
                yield x, y


def ground_grid(raw, e, n, size):
    width = int(size + 2 * PAD) + 1
    west, north = round(e - PAD), round(n + size + PAD)
    grid = np.full((width, width), -999999, np.float32)
    for x, y in sheets(e, n, size):
        with tifffile.TiffFile(Path(raw) / f"dem_x{x}y{y}.tif") as tif:
            sheet = tif.pages[0].asarray()
            tie = tif.geotiff_metadata["ModelTiepoint"]
            col, row = round(tie[3]) - west, north - round(tie[4])
            i, j = max(0, col), max(0, row)
            k, l = min(width, col + sheet.shape[1]), min(width, row + sheet.shape[0])
            part = sheet[j - row : l - row, i - col : k - col]
            np.copyto(grid[j:l, i:k], part, where=part > -9999)
    if not np.any(grid > -9999):
        raise ValueError("no project DEM samples in this square")
    return grid
