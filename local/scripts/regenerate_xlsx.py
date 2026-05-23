#!/usr/bin/env python3
"""regenerate_xlsx.py — собирает Finances.xlsx из локального SQLite.

Этап 0: минимальная заглушка. Полная версия в Этапе 3.

Usage:
    python local/scripts/regenerate_xlsx.py
    python local/scripts/regenerate_xlsx.py --out path/to/output.xlsx
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import ROOT, db_connect, set_sync_state  # noqa: E402

DEFAULT_OUT = ROOT / "reports" / "Finances.generated.xlsx"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    import xlsxwriter

    conn = db_connect()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    wb = xlsxwriter.Workbook(str(args.out))

    # Sheet: Accounts
    ws = wb.add_worksheet("Accounts")
    cols = ["id", "name", "type", "currency", "owner_id", "group_name", "yield_pct", "is_active"]
    for ci, col in enumerate(cols):
        ws.write(0, ci, col)
    for ri, row in enumerate(conn.execute(f"SELECT {', '.join(cols)} FROM accounts").fetchall(), start=1):
        for ci, col in enumerate(cols):
            ws.write(ri, ci, row[col])

    # Sheet: Expenses
    ws = wb.add_worksheet("Expenses")
    ecols = ["date", "amount", "currency", "account_id", "category_id", "note", "source", "created_at"]
    for ci, col in enumerate(ecols):
        ws.write(0, ci, col)
    for ri, row in enumerate(
        conn.execute(
            f"SELECT {', '.join(ecols)} FROM expenses WHERE deleted_at IS NULL ORDER BY date DESC LIMIT 5000"
        ).fetchall(),
        start=1,
    ):
        for ci, col in enumerate(ecols):
            ws.write(ri, ci, row[col])

    # Sheet: Rates
    ws = wb.add_worksheet("Rates")
    rcols = ["date", "base", "quote", "rate", "source", "fetched_at"]
    for ci, col in enumerate(rcols):
        ws.write(0, ci, col)
    for ri, row in enumerate(
        conn.execute(
            f"SELECT {', '.join(rcols)} FROM rates ORDER BY date DESC, base, quote LIMIT 5000"
        ).fetchall(),
        start=1,
    ):
        for ci, col in enumerate(rcols):
            ws.write(ri, ci, row[col])

    wb.close()
    set_sync_state(conn, "last_xlsx_regenerated_at", _now())
    conn.commit()
    print(f"wrote: {args.out}")
    return 0


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    sys.exit(main())
