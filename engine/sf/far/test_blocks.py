"""A block edge must preserve the covered area and the exposed bank of a pond."""
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "landing" / "ina"))
import matte


class FarBlockSeams(unittest.TestCase):
    def test_flat_pond_and_bank_cover_each_cell_once_across_block_seams(self):
        heights = np.ones((19, 21), dtype=np.int64)
        heights[8:] = 3
        pond = np.zeros(heights.shape, dtype=bool)
        pond[3:16, 5:19] = True
        zeros = np.zeros_like(heights)
        coverage = np.zeros_like(heights)
        bank = np.zeros(heights.shape[1], dtype=np.int64)
        with TemporaryDirectory() as directory, patch.object(matte, "BLOCK", 8):
            blocks = []
            matte.write(directory, blocks, "ground", heights, pond, zeros, zeros, zeros,
                        zeros, zeros, heights, 10, 0, 0, 1)
            for block in blocks:
                u, w = map(int, block["uw"])
                for pos, y, shape, _, _ in np.fromfile(Path(directory) / block["file"], "<u4").reshape(-1, 5):
                    x, z = u + int(pos & 2047), w + int((pos >> 11) & 2047)
                    width, depth = int(pos >> 22), int(shape & 1023)
                    axis = (shape >> 10) & 3
                    if axis == 0:
                        coverage[z:z + depth, x:x + width] += 1
                    elif axis == 2 and z == 8 and y == (30 << 16 | 10):
                        bank[x:x + width] += 1
        np.testing.assert_array_equal(coverage, pond)
        np.testing.assert_array_equal(bank, pond[8])


if __name__ == "__main__":
    unittest.main()
