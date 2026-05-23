#!/usr/bin/env python3
"""calc.py — пересчитывает формулы через LibreOffice headless.

Открывает файл в soffice, форсирует пересчёт, сохраняет обратно с актуальными
кэшированными значениями. После этого openpyxl(data_only=True) вернёт правильные
числа вместо None.

Требует: `brew install --cask libreoffice`.

Usage:
    python scripts/calc.py
    python scripts/calc.py path/to/file.xlsx
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import WORKBOOK_PATH, assert_not_open, create_backup  # noqa: E402

SOFFICE_CANDIDATES = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    shutil.which("soffice") or "",
    shutil.which("libreoffice") or "",
]


def find_soffice() -> str:
    for c in SOFFICE_CANDIDATES:
        if c and Path(c).exists():
            return c
    sys.stderr.write(
        "ERROR: LibreOffice not found.\n"
        "Install:  brew install --cask libreoffice\n"
    )
    sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", nargs="?", default=str(WORKBOOK_PATH), type=Path)
    args = ap.parse_args()

    assert_not_open(args.file)
    soffice = find_soffice()
    backup = create_backup(args.file)
    print(f"backup: {backup}")

    with tempfile.TemporaryDirectory() as td:
        profile = Path(td) / "lo-profile"
        outdir = Path(td) / "out"
        outdir.mkdir()
        cmd = [
            soffice,
            "--headless",
            "--calc",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "xlsx",
            "--outdir",
            str(outdir),
            str(args.file),
        ]
        print(" ".join(cmd))
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            sys.stderr.write(r.stderr)
            return r.returncode
        result = outdir / args.file.name
        if not result.exists():
            sys.stderr.write("ERROR: soffice did not produce output file\n")
            return 1
        shutil.copy2(result, args.file)
    print(f"OK — formulas recalculated in {args.file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
