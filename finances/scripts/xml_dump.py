#!/usr/bin/env python3
"""xml_dump.py — распаковывает .xlsx и (опционально) pretty-print'ит XML.

.xlsx — это zip с XML внутри. Этот скрипт даёт «голую» структуру для глубокой
диагностики (особенно когда нужно понять, что именно openpyxl потерял при save).

Usage:
    python scripts/xml_dump.py                          # extract в /tmp/finances-xml-<ts>/
    python scripts/xml_dump.py --inline                 # все XML в stdout
    python scripts/xml_dump.py --part xl/workbook.xml   # один part в stdout
"""
from __future__ import annotations

import argparse
import datetime as _dt
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import WORKBOOK_PATH  # noqa: E402


def pretty(xml_bytes: bytes) -> str:
    """Pretty-print через xmllint, с fallback на minidom."""
    try:
        r = subprocess.run(
            ["xmllint", "--format", "-"], input=xml_bytes, capture_output=True
        )
        if r.returncode == 0:
            return r.stdout.decode("utf-8", "replace")
    except FileNotFoundError:
        pass
    from xml.dom import minidom

    try:
        return minidom.parseString(xml_bytes).toprettyxml(indent="  ")
    except Exception:
        return xml_bytes.decode("utf-8", "replace")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", nargs="?", default=str(WORKBOOK_PATH), type=Path)
    ap.add_argument("--inline", action="store_true",
                    help="print all parts to stdout")
    ap.add_argument("--part", help="extract single XML part to stdout")
    args = ap.parse_args()

    with zipfile.ZipFile(args.file) as z:
        if args.part:
            data = z.read(args.part)
            if args.part.endswith((".xml", ".rels", ".vml")):
                print(pretty(data))
            else:
                print(data.decode("utf-8", "replace"))
            return 0
        if args.inline:
            for name in z.namelist():
                print(f"=== {name} ===")
                if name.endswith((".xml", ".rels", ".vml")):
                    print(pretty(z.read(name)))
                else:
                    print(f"[binary, {z.getinfo(name).file_size} bytes]")
            return 0

        ts = _dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
        outdir = Path(tempfile.gettempdir()) / f"finances-xml-{ts}"
        z.extractall(outdir)
        for name in z.namelist():
            if name.endswith((".xml", ".rels", ".vml")):
                p = outdir / name
                p.write_text(pretty(p.read_bytes()), encoding="utf-8")
        print(f"extracted (pretty-printed): {outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
