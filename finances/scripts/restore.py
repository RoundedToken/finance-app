#!/usr/bin/env python3
"""restore.py — восстанавливает Finances.xlsx из выбранного backup-а.

Usage:
    python scripts/restore.py                            # покажет список бэкапов
    python scripts/restore.py backups/Finances.<ts>.xlsx # восстановит конкретный
    python scripts/restore.py --latest                   # самый свежий
    python scripts/restore.py --latest --yes             # без подтверждения
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import BACKUP_DIR, WORKBOOK_PATH, assert_not_open  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", nargs="?", type=Path, help="path to backup file")
    ap.add_argument("--latest", action="store_true")
    ap.add_argument("--yes", action="store_true", help="skip confirmation")
    args = ap.parse_args()

    backups = sorted(BACKUP_DIR.glob(f"{WORKBOOK_PATH.stem}.*.xlsx"))

    if args.latest:
        if not backups:
            sys.stderr.write("No backups found in backups/\n")
            return 1
        src = backups[-1]
    elif args.source:
        src = args.source
    else:
        if not backups:
            print("No backups found in backups/")
            return 0
        print("Available backups (newest last):")
        for b in backups:
            print(f"  {b}")
        return 0

    if not src.exists():
        sys.stderr.write(f"ERROR: backup not found: {src}\n")
        return 1

    assert_not_open(WORKBOOK_PATH)
    if not args.yes:
        ans = input(
            f"Restore {src.name} → {WORKBOOK_PATH.name}? [y/N] "
        ).strip().lower()
        if ans != "y":
            print("aborted")
            return 0
    shutil.copy2(src, WORKBOOK_PATH)
    print(f"restored: {src} → {WORKBOOK_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
