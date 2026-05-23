#!/usr/bin/env python3
"""push_references.py — отправляет accounts/categories/currencies в Cloudflare D1.

Mini App грузит их через /v1/bootstrap для построения UI. Запускать после
любой миграции, добавляющей/меняющей справочники.

Usage:
    python local/scripts/push_references.py
    python local/scripts/push_references.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import assert_env, db_connect, set_sync_state  # noqa: E402


def fetch_references(conn) -> dict:
    def rows(query: str) -> list[dict]:
        return [dict(r) for r in conn.execute(query)]

    return {
        "currencies": rows("SELECT code, name, emoji, is_crypto, decimals FROM currencies"),
        "accounts": rows(
            "SELECT id, name, type, currency, is_active, color FROM accounts WHERE is_active = 1"
        ),
        "categories": rows(
            "SELECT id, name, type, parent_id, emoji, color, sort_order, is_active "
            "FROM categories WHERE is_active = 1 ORDER BY sort_order, name"
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env = assert_env("CF_WORKER_URL", "SYNC_TOKEN")
    conn = db_connect()
    refs = fetch_references(conn)

    print(
        f"currencies: {len(refs['currencies'])} | "
        f"accounts: {len(refs['accounts'])} | "
        f"categories: {len(refs['categories'])}"
    )

    if args.dry_run:
        print(json.dumps(refs, ensure_ascii=False, indent=2))
        return 0

    import requests

    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/admin/references"
    headers = {
        "Authorization": f"Bearer {env['SYNC_TOKEN']}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json=refs, headers=headers, timeout=60)
    r.raise_for_status()
    print("✓ pushed:", r.json())

    set_sync_state(conn, "last_references_pushed_at",
                   __import__("datetime").datetime.utcnow().isoformat() + "Z")
    conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
