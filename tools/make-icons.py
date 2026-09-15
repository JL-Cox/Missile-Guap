#!/usr/bin/env python3
"""
Generates the app icons with no image-library dependency, so anyone can
regenerate them from source and verify nothing odd is embedded in the PNGs.

    python3 tools/make-icons.py

Mark: a calm off-white card on the app's accent green, with three list lines
and a tick. Deliberately flat and low-contrast - it sits on a home screen all
day and should not shout.
"""
import struct
import zlib
from pathlib import Path

ACCENT = (74, 107, 93, 255)      # --accent
CARD = (255, 253, 248, 255)      # --surface
LINE = (143, 179, 161, 255)      # muted accent for the list lines
INK = (47, 74, 62, 255)          # --accent-text

OUT = Path(__file__).resolve().parent.parent / "public"


def blend(dst, src):
    """Alpha-composite src over dst."""
    a = src[3] / 255
    if a >= 1:
        return src
    return tuple(round(src[i] * a + dst[i] * (1 - a)) for i in range(3)) + (255,)


class Canvas:
    def __init__(self, size, background):
        self.size = size
        self.px = [[background for _ in range(size)] for _ in range(size)]

    def rect(self, x0, y0, x1, y1, colour, radius=0):
        for y in range(max(0, int(y0)), min(self.size, int(y1))):
            for x in range(max(0, int(x0)), min(self.size, int(x1))):
                if radius:
                    # Distance from the nearest corner centre, for rounded corners.
                    cx = min(max(x, x0 + radius), x1 - radius)
                    cy = min(max(y, y0 + radius), y1 - radius)
                    if (x - cx) ** 2 + (y - cy) ** 2 > radius * radius:
                        continue
                self.px[y][x] = blend(self.px[y][x], colour)

    def to_png(self, path):
        raw = bytearray()
        for row in self.px:
            raw.append(0)  # filter type 0 for every scanline
            for r, g, b, a in row:
                raw += bytes((r, g, b, a))

        def chunk(tag, data):
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

        ihdr = struct.pack(">IIBBBBB", self.size, self.size, 8, 6, 0, 0, 0)
        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b"")
        )
        path.write_bytes(png)


def draw(size, inset_ratio, corner_ratio):
    """inset_ratio leaves a safe margin; maskable icons need a generous one."""
    c = Canvas(size, ACCENT)
    inset = size * inset_ratio
    c.rect(inset, inset, size - inset, size - inset, CARD, radius=size * corner_ratio)

    # Three list lines and a tick, inside the card.
    span = size - 2 * inset
    pad = span * 0.16
    left = inset + pad
    right = size - inset - pad
    thickness = max(2, span * 0.075)
    for i in range(3):
        top = inset + pad + i * (span - 2 * pad) / 3.2
        width = right - left if i < 2 else (right - left) * 0.6
        c.rect(left, top, left + width, top + thickness, LINE if i else INK, radius=thickness / 2)

    # A small tick sitting at the end of the short last line.
    tick_x = left + (right - left) * 0.68
    tick_y = inset + pad + 2 * (span - 2 * pad) / 3.2
    step = max(1, int(thickness * 0.55))
    for i in range(int(thickness * 1.6)):
        c.rect(tick_x + i * 0.5, tick_y + thickness * 0.4 + i * 0.5, tick_x + i * 0.5 + step, tick_y + thickness * 0.4 + i * 0.5 + step, INK)
    for i in range(int(thickness * 2.6)):
        c.rect(tick_x + thickness * 0.8 + i * 0.6, tick_y + thickness * 1.3 - i * 0.6, tick_x + thickness * 0.8 + i * 0.6 + step, tick_y + thickness * 1.3 - i * 0.6 + step, INK)
    return c


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        draw(size, 0.13, 0.11).to_png(OUT / f"icon-{size}.png")
    # Maskable icons get cropped to a circle on some launchers, so pull the
    # artwork well inside the safe zone.
    draw(512, 0.24, 0.10).to_png(OUT / "icon-maskable-512.png")
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("icon*.png"))))


if __name__ == "__main__":
    main()
