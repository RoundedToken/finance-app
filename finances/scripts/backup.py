#!/usr/bin/env python3
"""backup.py — создаёт timestamp-копию рабочего файла в backups/.

Usage:
    python scripts/backup.py                  # бэкапит Finances.xlsx
    python scripts/backup.py path/to/file.xlsx
    python scripts/backup.py --json
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import WORKBOOK_PATH, create_backup, print_json  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", nargs="?", default=str(WORKBOOK_PATH), type=Path)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    dest = create_backup(args.file)
    if args.json:
        print_json({"source": str(args.file), "backup": str(dest)})
    else:
        print(f"backup: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
