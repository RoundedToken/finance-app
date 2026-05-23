#!/usr/bin/env python3
"""roundtrip_check.py — сверяет инвентарь двух .xlsx.

После save рабочего файла — сравнить с последним backup-ом: если число графиков,
таблиц, именованных диапазонов или conditional formats упало, что-то сломалось.
Возвращает exit code 3 если расхождения.

Usage:
    python scripts/roundtrip_check.py Finances.xlsx backups/Finances.<ts>.xlsx
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import inventory  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("current", type=Path)
    ap.add_argument("baseline", type=Path)
    args = ap.parse_args()

    cur = inventory(args.current)
    base = inventory(args.baseline)

    diffs: list[str] = []
    if len(cur["defined_names"]) != len(base["defined_names"]):
        diffs.append(
            f"defined_names: {len(base['defined_names'])} → {len(cur['defined_names'])}"
        )
    cur_sheets = {s["name"]: s for s in cur["sheets"]}
    base_sheets = {s["name"]: s for s in base["sheets"]}
    if set(cur_sheets) != set(base_sheets):
        diffs.append(
            f"sheet set changed: {sorted(base_sheets)} → {sorted(cur_sheets)}"
        )
    for name in set(cur_sheets) & set(base_sheets):
        c, b = cur_sheets[name], base_sheets[name]
        for k in ("charts", "images", "tables", "data_validations",
                  "conditional_formats", "merged_cells"):
            if c[k] != b[k]:
                diffs.append(f"{name}.{k}: {b[k]} → {c[k]}")

    if diffs:
        print("STRUCTURAL CHANGES DETECTED:")
        for d in diffs:
            print(f"  - {d}")
        print(f"\nTo revert: python scripts/restore.py {args.baseline}")
        return 3
    print(f"OK — {args.current.name} structurally matches {args.baseline.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
