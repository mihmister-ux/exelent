"""Числовой разбор референса: пропорции тёмного блока с белым текстом.

Глазами картинку здесь проверить нельзя (vision недоступен), поэтому меряем
пиксели. Габариты плашки берём по центральным линиям кадра — так фон вокруг
блока не попадает в замер, как это было бы с обычным bbox по всему кадру.
"""

import sys

from PIL import Image, ImageOps

path = sys.argv[1]
image = ImageOps.grayscale(Image.open(path))
width, height = image.size
pixels = image.load()

DARK = 128
LIGHT = 170


def longest_dark_run(values):
    best = (0, -1)
    start = None
    for index, value in enumerate(values):
        if value < DARK:
            if start is None:
                start = index
        elif start is not None:
            if index - 1 - start > best[1] - best[0]:
                best = (start, index - 1)
            start = None
    if start is not None and len(values) - 1 - start > best[1] - best[0]:
        best = (start, len(values) - 1)
    return best


x0, x1 = longest_dark_run([pixels[x, height // 2] for x in range(width)])
y0, y1 = longest_dark_run([pixels[width // 2, y] for y in range(height)])

block_w = x1 - x0 + 1
block_h = y1 - y0 + 1
print(f"image            {width}x{height}")
print(f"block            x {x0}..{x1}  y {y0}..{y1}")
print(f"block size       {block_w} x {block_h}   aspect {block_w / block_h:.2f}")

xs, ys = [], []
for y in range(y0, y1 + 1):
    for x in range(x0, x1 + 1):
        if pixels[x, y] > LIGHT:
            xs.append(x)
            ys.append(y)

if xs:
    tx0, tx1 = min(xs), max(xs)
    ty0, ty1 = min(ys), max(ys)
    text_h = ty1 - ty0 + 1
    print(f"text             x {tx0}..{tx1}  y {ty0}..{ty1}   size {tx1 - tx0 + 1} x {text_h}")
    print(f"padding left     {tx0 - x0}   ({(tx0 - x0) / block_h:.2f} of height)")
    print(f"padding right    {x1 - tx1}   ({(x1 - tx1) / block_h:.2f} of height)")
    print(f"padding top      {ty0 - y0}")
    print(f"padding bottom   {y1 - ty1}")
    print(f"text height      {text_h / block_h:.2f} of block height")

print("skew: right edge inset per row from the top (radius probe)")
for y in range(y0, min(y0 + block_h // 4, y1 + 1)):
    row = [x for x in range(width) if pixels[x, y] < DARK]
    if row:
        print(f"  +{y - y0:>3}  left inset {min(row) - x0:>4}   right inset {x1 - max(row):>4}")
