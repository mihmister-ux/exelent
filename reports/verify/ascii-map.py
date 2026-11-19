"""ASCII-карта яркости: единственный способ «посмотреть» картинку без vision.

Печатает сетку символов от «@» (чёрное) до «.» (белое) — по ней видно, где
находятся крупные блоки, и можно прицельно измерить нужный.
"""

import sys

from PIL import Image, ImageOps

path = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 96
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 36

image = ImageOps.grayscale(Image.open(path))
small = image.resize((cols, rows), Image.BOX)
pixels = list(small.getdata())

ramp = "@%#*+=-:. "
for y in range(rows):
    line = ""
    for x in range(cols):
        value = pixels[y * cols + x]
        line += ramp[min(len(ramp) - 1, value * len(ramp) // 256)]
    print(line)
