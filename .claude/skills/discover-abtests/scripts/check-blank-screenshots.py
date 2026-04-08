#!/usr/bin/env python3
"""
Check screenshots for blank/near-blank content.

After a visreg test run, this script scans all experiment screenshots and flags
any where 70%+ of pixels share the same color. That's a strong signal the
screenshot captured an empty container, unhydrated page, or missed lazy-loaded
content — not real UI.

Usage (run from the app directory containing visreg_data/):
    python3 <skill-dir>/scripts/check-blank-screenshots.py [--threshold 0.70]

Output: JSON array of objects, one per flagged screenshot:
    { "file": "...", "dominant_pct": 0.92, "dominant_color": [255, 255, 255] }

Exit code 0 if no blanks found, 1 if any flagged.
"""

import argparse
import glob
import json
import struct
import sys
import zlib
from pathlib import Path


def read_png_pixels(filepath: str) -> tuple[list[tuple[int, int, int]], int, int]:
    """Read RGB pixel data from a PNG without external dependencies."""
    with open(filepath, "rb") as f:
        data = f.read()

    # Verify PNG signature
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a valid PNG: {filepath}")

    # Parse IHDR
    pos = 8
    length = struct.unpack(">I", data[pos : pos + 4])[0]
    chunk_type = data[pos + 4 : pos + 8]
    if chunk_type != b"IHDR":
        raise ValueError("Missing IHDR chunk")
    width, height, bit_depth, color_type = struct.unpack(
        ">IIBB", data[pos + 8 : pos + 18]
    )
    pos += 12 + length  # length field + type + data + crc

    # Collect IDAT chunks
    idat_data = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        chunk_type = data[pos + 4 : pos + 8]
        if chunk_type == b"IDAT":
            idat_data += data[pos + 8 : pos + 8 + length]
        elif chunk_type == b"IEND":
            break
        pos += 12 + length  # length field + type + data + crc

    raw = zlib.decompress(idat_data)

    # Determine bytes per pixel
    if color_type == 2:  # RGB
        bpp = 3
    elif color_type == 6:  # RGBA
        bpp = 4
    elif color_type == 0:  # Grayscale
        bpp = 1
    elif color_type == 4:  # Grayscale + alpha
        bpp = 2
    else:
        raise ValueError(f"Unsupported color type {color_type}")

    stride = 1 + width * bpp  # filter byte + pixel data per row
    pixels = []

    # Reconstruct scanlines with PNG filtering
    prev_row = bytes(width * bpp)
    offset = 0
    for _y in range(height):
        filter_type = raw[offset]
        scanline = bytearray(raw[offset + 1 : offset + 1 + width * bpp])
        offset += stride

        if filter_type == 1:  # Sub
            for i in range(len(scanline)):
                a = scanline[i - bpp] if i >= bpp else 0
                scanline[i] = (scanline[i] + a) & 0xFF
        elif filter_type == 2:  # Up
            for i in range(len(scanline)):
                scanline[i] = (scanline[i] + prev_row[i]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(len(scanline)):
                a = scanline[i - bpp] if i >= bpp else 0
                scanline[i] = (scanline[i] + (a + prev_row[i]) // 2) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(len(scanline)):
                a = scanline[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                c = prev_row[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                scanline[i] = (scanline[i] + pr) & 0xFF

        prev_row = bytes(scanline)

        for x in range(width):
            idx = x * bpp
            if bpp >= 3:
                pixels.append((scanline[idx], scanline[idx + 1], scanline[idx + 2]))
            else:
                pixels.append(
                    (scanline[idx], scanline[idx], scanline[idx])
                )

    return pixels, width, height


def check_screenshot(filepath: str, threshold: float) -> dict | None:
    """Return info dict if dominant color exceeds threshold, else None."""
    try:
        pixels, width, height = read_png_pixels(filepath)
    except Exception as e:
        return {"file": filepath, "error": str(e)}

    total = len(pixels)
    if total == 0:
        return {"file": filepath, "error": "empty image"}

    # Count colors (quantize to reduce noise — bucket to nearest 8)
    buckets: dict[tuple[int, int, int], int] = {}
    for r, g, b in pixels:
        key = (r & 0xF8, g & 0xF8, b & 0xF8)
        buckets[key] = buckets.get(key, 0) + 1

    dominant_color, dominant_count = max(buckets.items(), key=lambda x: x[1])
    dominant_pct = dominant_count / total

    if dominant_pct >= threshold:
        return {
            "file": filepath,
            "dominant_pct": round(dominant_pct, 4),
            "dominant_color": list(dominant_color),
            "dimensions": f"{width}x{height}",
        }
    return None


def screenshots_from_report(report_path: str, report_dir: str) -> list[str]:
    """Return experiment screenshot paths listed in report.json."""
    import json as _json

    with open(report_path) as f:
        data = _json.load(f)

    paths = []
    for test in data.get("tests", []):
        rel = test.get("pair", {}).get("test", "")
        if rel:
            paths.append(str(Path(report_dir) / rel))
    return paths


def main():
    parser = argparse.ArgumentParser(
        description="Flag near-blank visreg screenshots"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.70,
        help="Fraction of pixels that must share one color to flag (default: 0.70)",
    )
    parser.add_argument(
        "--dir",
        default="visreg_data/html_report/experiment_screenshot",
        help="Directory to scan for .png files (ignored when --report is used)",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Path to report.json — when given, only check screenshots from the last test run",
    )
    args = parser.parse_args()

    if args.report:
        report_dir = str(Path(args.report).parent)
        screenshots = screenshots_from_report(args.report, report_dir)
    else:
        screenshots = glob.glob(f"{args.dir}/**/*.png", recursive=True)
        screenshots += glob.glob(f"{args.dir}/*.png")
        screenshots = list(set(screenshots))  # dedupe

    if not screenshots:
        print("[]")
        return

    flagged = []
    for path in sorted(screenshots):
        result = check_screenshot(path, args.threshold)
        if result:
            flagged.append(result)

    print(json.dumps(flagged, indent=2))
    if flagged:
        sys.exit(1)


if __name__ == "__main__":
    main()
