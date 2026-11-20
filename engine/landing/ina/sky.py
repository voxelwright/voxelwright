"""The photograph's sky (#423): which pixels are sky, and so where its skyline runs. A pixel is sky when it is
joined to the top of the frame through pixels that are smooth (no edge of a building crosses) and are the sky's
colours (blue, or the pale grey-blue of cloud). Worked out at twice the photograph's stated width, 4000 pixels.

    python sky.py        writes DATA/sky.png (the mask, 4000 wide) and DATA/skyline.npy (for each column, the first row that is not sky)
"""
import os, sys
import numpy as np
import cv2
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from place import DATA, REF

TIMES = 2


def mask():
    im = cv2.imread(f'{REF}/ina-full.jpg')
    im = cv2.resize(im, (2000 * TIMES, round(im.shape[0] * 2000 * TIMES / im.shape[1])), interpolation=cv2.INTER_AREA)
    b, g, r = (im[:, :, k].astype(np.float32) for k in range(3))
    soft = cv2.GaussianBlur(im, (0, 0), 1.0).astype(np.float32)
    gx, gy = cv2.Sobel(soft, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(soft, cv2.CV_32F, 0, 1, ksize=3)
    edge = np.sqrt((gx ** 2 + gy ** 2).sum(2)) / 8
    # Sky: bluer than it is red, and bright; cloud is paler but never warm and never dark.
    like = (b > r + 4) & (b > 120) & (b >= g - 2)
    # An edge is a wall the sky does not pass: found a little more readily than it shows, and a pixel wider, so that
    # a white tower's shaded side (the colour of haze, and smooth) is not let in through a gap in its outline.
    calm = ~ndimage.binary_dilation(edge >= 6.0, iterations=1)
    grow = like & calm
    lab, _ = ndimage.label(grow)
    tops = np.unique(lab[0][lab[0] > 0])
    sky = np.isin(lab, tops)
    # The edge itself was left out on both sides: take the sky a pixel further, where it is still the sky's colour.
    sky = sky | (ndimage.binary_dilation(sky, iterations=3) & like & (edge < 14.0))
    sky = ndimage.binary_opening(sky, iterations=1)
    # Only sky that reaches down from the top without a break counts in a column.
    return sky, im


def main():
    sky, im = mask()
    line = np.argmin(sky, axis=0).astype(np.int32)
    line[sky.all(0)] = sky.shape[0]
    cv2.imwrite(f'{DATA}/sky.png', (sky * 255).astype(np.uint8))
    np.save(f'{DATA}/skyline.npy', line)
    show = im.copy()
    show[sky] = (show[sky] * 0.4 + np.array([255, 0, 255]) * 0.6).astype(np.uint8)
    for x in range(show.shape[1]):
        y = line[x]
        show[max(0, y - 1):y + 1, x] = (0, 255, 255)
    cv2.imwrite(f'{DATA}/sky-check.jpg', cv2.resize(show, (2000, show.shape[0] // TIMES), interpolation=cv2.INTER_AREA))
    print('sky', round(float(sky.mean()), 3), 'skyline rows', int(line.min()), int(line.max()))


if __name__ == '__main__':
    main()
