#!/usr/bin/env python3
"""migrate_to_d1.py — однократная миграция expenses из local SQLite в D1.

После D1-centric pivot все expenses живут в D1. Запускается один раз для
переноса исторических данных (1820 трат из CSV + 1 от текстового бота).

Usage:
    python local/scripts/migrate_to_d1.py
    python local/scripts/migrate_to_d1.py --owner 307411613
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import assert_env, db_connect  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--owner", default="307411613", help="Telegram user_id для всех мигрируемых записей")
    ap.add_argument("--batch", type=int, default=200)
    args = ap.parse_args()

    env = assert_env("CF_WORKER_URL", "SYNC_TOKEN")
    conn = db_connect()
    rows = conn.execute(
        """
        SELECT id, date, account_id, amount, currency, category_id, note,
               source, source_record_id, created_at, synced_at
        FROM expenses
        WHERE deleted_at IS NULL
        ORDER BY created_at
        """
    ).fetchall()
    print(f"prepared {len(rows)} expenses for migration")

    import requests

    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/admin/migrate-expenses"
    headers = {
        "Authorization": f"Bearer {env['SYNC_TOKEN']}",
        "Content-Type": "application/json",
    }
    total_inserted = 0
    for i in range(0, len(rows), args.batch):
        batch = rows[i : i + args.batch]
        payload = [
            {
                "id": r["id"],
                "date": r["date"],
                "account_id": r["account_id"],
                "amount": r["amount"],
                "currency": r["currency"],
                "category_id": r["category_id"],
                "note": r["note"],
                "source": r["source"],
                "source_record_id": r["source_record_id"],
                "user_id": args.owner,
                "created_at": r["created_at"],
                "updated_at": r["created_at"],
            }
            for r in batch
        ]
        resp = requests.post(url, json={"expenses": payload}, headers=headers, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        total_inserted += data.get("inserted", 0)
        print(f"  batch {i//args.batch + 1}: attempted={data.get('attempted')} inserted={data.get('inserted')}")
        time.sleep(0.1)

    print(f"\n✓ total inserted: {total_inserted} (some may be duplicates → IGNORED)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
