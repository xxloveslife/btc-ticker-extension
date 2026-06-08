"""Generate simple Bitcoin-orange coin icons (no external deps; pure stdlib PNG writer)."""
import struct
import zlib
import os
import math

ORANGE = (247, 147, 26)  # Bitcoin orange


def make_png(path, size):
    cx = cy = (size - 1) / 2
    radius = size / 2
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter byte: none
        for x in range(size):
            dist = math.hypot(x - cx, y - cy)
            if dist <= radius - 0.5:
                raw += bytes((ORANGE[0], ORANGE[1], ORANGE[2], 255))
            else:
                raw += bytes((0, 0, 0, 0))  # transparent outside the circle

    def chunk(typ, data):
        body = typ + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    icons = os.path.join(here, "icons")
    os.makedirs(icons, exist_ok=True)
    for s in (16, 32, 48, 128):
        make_png(os.path.join(icons, f"icon{s}.png"), s)
        print(f"wrote icons/icon{s}.png")
