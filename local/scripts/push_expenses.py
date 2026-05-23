#!/usr/bin/env python3
"""push_expenses.py — отправляет последние N трат из локального SQLite в D1 cache.

Mini App при /v1/bootstrap получает их и показывает в Истории. Это снапшот для
отображения, не источник правды.

Usage:
    python local/scripts/push_expenses.py
    python local/scripts/push_expenses.py --limit 500
    python local/scripts/push_expenses.py --dry-run
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import assert_env, db_connect, set_sync_state  # noqa: E402


def fetch_recent(conn, limit: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, date, account_id, amount, currency, category_id, note, source, created_at
        FROM expenses
        WHERE deleted_at IS NULL
        ORDER BY date DESC, created_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env = assert_env("CF_WORKER_URL", "SYNC_TOKEN")
    conn = db_connect()
    expenses = fetch_recent(conn, args.limit)
    print(f"prepared {len(expenses)} expenses for cache push")

    if args.dry_run:
        return 0

    import requests

    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/admin/expenses-cache"
    headers = {
        "Authorization": f"Bearer {env['SYNC_TOKEN']}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json={"expenses": expenses}, headers=headers, timeout=120)
    r.raise_for_status()
    print("✓ pushed:", r.json())

    set_sync_state(
        conn,
        "last_expenses_pushed_at",
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
