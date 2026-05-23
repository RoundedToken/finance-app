#!/usr/bin/env python3
"""sync.py — тянет новые expenses из Cloudflare D1, пишет в local SQLite, подтверждает.

Usage:
    python local/scripts/sync.py --once             # один проход и выход
    python local/scripts/sync.py --watch [--interval 900]  # бесконечный цикл

Идемпотентен: INSERT OR IGNORE по UUID. Повторный запуск безопасен.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    assert_env,
    db_connect,
    get_sync_state,
    set_sync_state,
)

EPOCH = "1970-01-01T00:00:00Z"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_new(env: dict[str, str], since: str) -> dict:
    import requests

    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/sync"
    headers = {"Authorization": f"Bearer {env['SYNC_TOKEN']}"}
    r = requests.get(url, params={"since": since}, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def confirm(env: dict[str, str], ids: list[str]) -> int:
    if not ids:
        return 0
    import requests

    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/sync/confirm"
    headers = {
        "Authorization": f"Bearer {env['SYNC_TOKEN']}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json={"ids": ids}, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("confirmed", 0)


def send_heartbeat(env: dict[str, str], payload: dict) -> None:
    """Best-effort: ошибки логируем, но не падаем — heartbeat не должен ломать sync."""
    try:
        import requests

        url = env["CF_WORKER_URL"].rstrip("/") + "/v1/sync/heartbeat"
        headers = {
            "Authorization": f"Bearer {env['SYNC_TOKEN']}",
            "Content-Type": "application/json",
        }
        requests.post(url, json=payload, headers=headers, timeout=15)
    except Exception as e:
        sys.stderr.write(f"heartbeat failed (non-fatal): {e}\n")


def _existing_ids(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[0] for r in conn.execute(f"SELECT id FROM {table}")}


def _existing_codes(conn: sqlite3.Connection, table: str, col: str = "code") -> set[str]:
    return {r[0] for r in conn.execute(f"SELECT {col} FROM {table}")}


def insert_expenses(conn: sqlite3.Connection, rows: list[dict]) -> int:
    """
    Резильентно вставляет expenses.
    Если account_id / category_id / currency не существуют в справочниках —
    кладёт NULL вместо них и записывает оригинальное значение в note (с пометкой),
    чтобы потом ручками разобрать. Никогда не теряем сами цифры.
    """
    if not rows:
        return 0

    accounts = _existing_ids(conn, "accounts")
    categories = _existing_ids(conn, "categories")
    currencies = _existing_codes(conn, "currencies")

    cur = conn.cursor()
    inserted = 0
    for r in rows:
        unresolved: list[str] = []
        account_id = r.get("account_id")
        if account_id and account_id not in accounts:
            unresolved.append(f"account={account_id}")
            account_id = None
        category_id = r.get("category_id")
        if category_id and category_id not in categories:
            unresolved.append(f"category={category_id}")
            category_id = None
        currency = r["currency"]
        if currency not in currencies:
            # Валюта обязательна и NOT NULL — добавляем на лету (в норме не должно бывать)
            conn.execute(
                "INSERT OR IGNORE INTO currencies (code, name) VALUES (?, ?)",
                (currency, currency),
            )
            currencies.add(currency)
            unresolved.append(f"currency_autocreated={currency}")

        note = r.get("note") or ""
        if unresolved:
            tag = "[unresolved: " + ", ".join(unresolved) + "]"
            note = f"{note} {tag}".strip() if note else tag

        cur.execute(
            """
            INSERT OR IGNORE INTO expenses
                (id, date, account_id, amount, currency, category_id,
                 note, source, source_record_id, created_at, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'telegram', NULL, ?, ?)
            """,
            (
                r["id"],
                r["date"],
                account_id,
                r["amount"],
                currency,
                category_id,
                note or None,
                r["created_at"],
                _now_iso(),
            ),
        )
        if cur.rowcount > 0:
            inserted += 1
    conn.commit()
    return inserted


def log_sync_attempt(conn: sqlite3.Connection, **fields) -> int:
    cur = conn.execute(
        """
        INSERT INTO sync_log (started_at, finished_at, pulled, inserted, confirmed, error, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            fields["started_at"],
            fields.get("finished_at"),
            fields.get("pulled", 0),
            fields.get("inserted", 0),
            fields.get("confirmed", 0),
            fields.get("error"),
            fields.get("duration_ms"),
        ),
    )
    conn.commit()
    return cur.lastrowid


def run_once(verbose: bool = True) -> dict:
    env = assert_env("CF_WORKER_URL", "SYNC_TOKEN")
    started_at = _now_iso()
    t0 = time.time()
    conn = db_connect()
    since = get_sync_state(conn, "last_synced_at", EPOCH) or EPOCH

    try:
        data = fetch_new(env, since)
    except Exception as e:
        log_sync_attempt(
            conn,
            started_at=started_at,
            finished_at=_now_iso(),
            error=str(e),
            duration_ms=int((time.time() - t0) * 1000),
        )
        if verbose:
            sys.stderr.write(f"fetch failed: {e}\n")
        return {"ok": False, "error": str(e)}

    rows = data.get("expenses", [])
    pulled = len(rows)
    inserted = insert_expenses(conn, rows)
    confirmed = 0
    if rows:
        ids = [r["id"] for r in rows]
        try:
            confirmed = confirm(env, ids)
        except Exception as e:
            log_sync_attempt(
                conn,
                started_at=started_at,
                finished_at=_now_iso(),
                pulled=pulled,
                inserted=inserted,
                error=f"confirm failed: {e}",
                duration_ms=int((time.time() - t0) * 1000),
            )
            if verbose:
                sys.stderr.write(f"confirm failed: {e}\n")
            return {"ok": False, "pulled": pulled, "inserted": inserted, "error": str(e)}

    next_since = data.get("next_since") or since
    set_sync_state(conn, "last_synced_at", next_since)
    conn.commit()

    duration_ms = int((time.time() - t0) * 1000)
    log_sync_attempt(
        conn,
        started_at=started_at,
        finished_at=_now_iso(),
        pulled=pulled,
        inserted=inserted,
        confirmed=confirmed,
        duration_ms=duration_ms,
    )
    send_heartbeat(
        env,
        {
            "device_id": "macbook",
            "last_sync_attempt_at": started_at,
            "last_sync_success_at": _now_iso(),
            "last_pulled": pulled,
            "last_inserted": inserted,
            "last_confirmed": confirmed,
        },
    )
    # Если были новые записи — обновим cache в D1 чтобы Mini App видел свежее.
    if inserted > 0:
        try:
            from push_expenses import main as push_expenses_main

            sys.argv = ["push_expenses.py", "--limit", "500"]
            push_expenses_main()
        except Exception as e:
            sys.stderr.write(f"push_expenses (non-fatal): {e}\n")
    result = {
        "ok": True,
        "pulled": pulled,
        "inserted": inserted,
        "confirmed": confirmed,
        "duration_ms": duration_ms,
        "next_since": next_since,
    }
    if verbose:
        print(json.dumps(result, ensure_ascii=False))
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--once", action="store_true", help="один проход и выход")
    ap.add_argument("--watch", action="store_true", help="бесконечный цикл")
    ap.add_argument("--interval", type=int, default=900, help="секунд между sync в --watch")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if not args.once and not args.watch:
        args.once = True

    if args.once:
        res = run_once(verbose=not args.quiet)
        return 0 if res.get("ok") else 1

    while True:
        try:
            run_once(verbose=not args.quiet)
        except Exception as e:
            sys.stderr.write(f"sync error: {e}\n")
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
