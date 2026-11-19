"""Иконки приложения: белый лист, тёмная рамка и три полосы статусов срока.

Полосы — те же цвета, что красили строки журнала в Excel (#8B0000, #FF0000,
#FFEB9C). Ничего декоративного: иконка повторяет главный экран — список
позиций с цветными статусами.

Запуск:
    python scripts/make_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "public" / "icons"

WHITE = (255, 255, 255, 255)
INK = (15, 23, 42, 255)
BARS = [(139, 0, 0, 255), (255, 0, 0, 255), (255, 235, 156, 255)]

SIZES = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}


def render(size: int, pad_ratio: float = 0.08) -> Image.Image:
    """Плитка с полосами статусов; pad_ratio — поля под обрезку (maskable)."""
    scale = 8  # рисуем крупно и уменьшаем: получаем ровные сглаженные края
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    pad = int(canvas * pad_ratio)
    stroke = max(int(canvas * 0.045), scale * 2)
    radius = int(canvas * 0.18)

    # Лист: белый, с тёмной рамкой — «документ», а не круглая иконка-кнопка.
    draw.rounded_rectangle(
        (pad, pad, canvas - pad, canvas - pad),
        radius=radius,
        fill=WHITE,
        outline=INK,
        width=stroke,
    )

    inner = int(canvas * 0.18)
    right = canvas - inner
    bar_height = int(canvas * 0.115)
    gap = int(canvas * 0.105)
    gap_x = int(canvas * 0.06)
    tick_len = int(canvas * 0.14)
    width = (right - inner) - gap_x - tick_len
    top = (canvas - (3 * bar_height + 2 * gap)) // 2 + int(canvas * 0.02)

    for index, color in enumerate(BARS):
        y = top + index * (bar_height + gap)
        draw.rounded_rectangle(
            (inner, y, inner + width, y + bar_height),
            radius=bar_height // 2,
            fill=color,
        )
        # Тёмная засечка справа — «строка журнала»: название и дата.
        line_y = y + bar_height // 2
        draw.rounded_rectangle(
            (inner + width + gap_x, line_y - stroke // 2,
             inner + width + gap_x + tick_len, line_y + stroke // 2),
            radius=stroke,
            fill=INK,
        )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)

    for name, size in SIZES.items():
        image = render(size)
        image.save(ICONS / name, format="PNG", optimize=True)
        print(f"{name}: {size}x{size}")

    # Maskable: тот же рисунок, но с запасом под обрезку по кругу.
    render(512, pad_ratio=0.18).save(ICONS / "icon-maskable-512.png", format="PNG", optimize=True)
    print("icon-maskable-512.png: 512x512")

    (ROOT / "public" / "favicon.svg").write_text(FAVICON_SVG, encoding="utf-8")
    print("favicon.svg")


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect x="4" y="4" width="56" height="56" rx="11" fill="#ffffff" stroke="#0f172a" stroke-width="4"/>
  <rect x="15" y="17" width="22" height="6" rx="3" fill="#8b0000"/>
  <rect x="43" y="18.5" width="8" height="3" rx="1.5" fill="#0f172a"/>
  <rect x="15" y="29" width="22" height="6" rx="3" fill="#ff0000"/>
  <rect x="43" y="30.5" width="8" height="3" rx="1.5" fill="#0f172a"/>
  <rect x="15" y="41" width="22" height="6" rx="3" fill="#ffeb9c"/>
  <rect x="43" y="42.5" width="8" height="3" rx="1.5" fill="#0f172a"/>
</svg>
"""


if __name__ == "__main__":
    main()
