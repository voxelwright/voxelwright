"""Draw the five orthographic fixtures read by the carve-and-drive test."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent


def sheet(name, side, front, rear, top):
    page = Image.new("RGB", (640, 520), "white")
    for view, centre in zip((side, ImageOps.mirror(side), front, rear, top),
                            ((160, 75), (480, 75), (160, 235), (480, 235), (320, 405))):
        page.paste(view, (centre[0] - view.width // 2, centre[1] - view.height // 2))
    page.save(HERE / (name + ".png"))


def panel(size, points, colour):
    image = Image.new("RGB", size, "white")
    ImageDraw.Draw(image).polygon(points, fill=colour)
    return image


gold = "#d6a22c"
side = panel((250, 50), [(0, 46), (8, 36), (135, 27), (170, 18), (210, 18),
                         (218, 2), (249, 2), (249, 48), (0, 48)], gold)
for axle in (48, 201):
    ImageDraw.Draw(side).ellipse((axle-13, 25, axle+13, 49), fill="#373739")
ends = [(0, 49), (0, 5), (99, 5), (99, 49)]
top = panel((250, 100), [(0, 38), (60, 30), (165, 8), (249, 0),
                         (249, 99), (165, 91), (60, 69), (0, 61)], gold)
sheet("racer", side, panel((100, 50), ends, gold), panel((100, 50), ends, "#974c24"), top)

hydrant = panel((76, 106), [(8, 105), (8, 96), (17, 92), (17, 65), (0, 64),
                            (0, 48), (17, 47), (17, 25), (12, 22), (27, 6),
                            (38, 1), (50, 6), (64, 22), (59, 25), (59, 47),
                            (75, 48), (75, 64), (59, 65), (59, 92), (68, 96),
                            (68, 105)], "#bd4236")
cap = Image.new("RGB", (76, 76), "white")
ImageDraw.Draw(cap).ellipse((0, 0, 75, 75), fill="#bd4236")
sheet("hydrant", hydrant, hydrant, hydrant, cap)
