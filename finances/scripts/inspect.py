#!/usr/bin/env python3
"""inspect.py — структурный паспорт Finances.xlsx.

Запускать первым делом перед любой правкой. Показывает листы, размеры, формулы,
charts, tables, named ranges, data validations, conditional formatting,
merged cells, freeze panes, защиту.

Usage:
    python scripts/inspect.py              # human-readable
    python scripts/inspect.py --json       # machine-readable
    python scripts/inspect.py path/to/file.xlsx
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import WORKBOOK_PATH, inventory, print_json  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", nargs="?", default=str(WORKBOOK_PATH), type=Path)
    ap.add_argument("--json", action="store_true", help="machine-readable JSON output")
    args = ap.parse_args()

    if not args.file.exists():
        sys.stderr.write(f"ERROR: file not found: {args.file}\n")
        return 1

    inv = inventory(args.file)

    if args.json:
        print_json(inv)
        return 0

    print(f"=== {inv['path']} ===")
    print(f"size:    {inv['size_bytes']:,} bytes")
    print(f"mtime:   {inv['mtime']}")
    print(f"vba:     {inv['vba']}")
    print(f"formulas (total): {inv['total_formulas']}")
    print(f"defined_names ({len(inv['defined_names'])}):")
    for n in inv["defined_names"]:
        print(f"    - {n}")
    print()
    for s in inv["sheets"]:
        print(f"--- Sheet: {s['name']} ---")
        print(f"  dims:        {s['max_row']} rows x {s['max_col']} cols")
        print(f"  formulas:    {s['formulas']}")
        print(f"  charts:      {s['charts']}")
        print(f"  images:      {s['images']}")
        print(f"  tables:      {s['tables']}")
        print(f"  data_valid:  {s['data_validations']}")
        print(f"  cond_fmt:    {s['conditional_formats']}")
        print(f"  merged:      {s['merged_cells']}")
        print(f"  freeze:      {s['freeze_panes']}")
        print(f"  protected:   {s['protected']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
