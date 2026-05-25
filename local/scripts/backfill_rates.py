#!/usr/bin/env python3
"""backfill_rates.py — однократная загрузка исторических курсов в D1.

Источник — Google Sheet «Finance Rates», лист `history` (ADR-006).
Формат CSV (3 GOOGLEFINANCE-массива в колонках A/D/G):

    Date,Close,,Date,Close,,Date,Close
    1/10/2024 23:58:00,1.09741,,1/10/2024 23:58:00,98.0553,,1/10/2024 23:58:00,117.102
    ...

Парсим, конвертируем в {date → {quote → rate}}, USDT = USD (пэг),
постим в /v1/admin/bulk-rates Worker'а пачками по 500.

Usage:
    python local/scripts/backfill_rates.py
    python local/scripts/backfill_rates.py --dry-run
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import assert_env  # noqa: E402

RATE_SOURCE = "google-sheets"


def fetch_history_csv(url: str) -> str:
    import requests
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.text


def parse_history(text: str) -> dict[str, dict[str, float]]:
    """CSV → {ISO-date: {USD: ..., RUB: ..., RSD: ..., USDT: ...}}."""
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader if any(c.strip() for c in row)]
    if len(rows) < 2:
        raise SystemExit("history csv: less than 2 rows, ничего парсить")
    # rows[0] = ["Date","Close","","Date","Close","","Date","Close","","Date","Close"]
    # Колонки: A/B = USD, D/E = RUB, G/H = RSD, J/K = TRY (added 2026-05-25).
    quotes = [("USD", 0, 1), ("RUB", 3, 4), ("RSD", 6, 7), ("TRY", 9, 10)]
    by_date: dict[str, dict[str, float]] = {}
    for row in rows[1:]:
        for quote, di, ci in quotes:
            if di >= len(row) or ci >= len(row):
                continue
            dstr, vstr = row[di].strip(), row[ci].strip()
            if not dstr or not vstr:
                continue
            iso = us_date_to_iso(dstr)
            if not iso:
                continue
            try:
                v = float(vstr)
            except ValueError:
                continue
            if v <= 0:
                continue
            by_date.setdefault(iso, {})[quote] = v
    # USDT = USD (peg)
    for iso, qs in by_date.items():
        if "USD" in qs:
            qs["USDT"] = qs["USD"]
    return by_date


def us_date_to_iso(s: str) -> str | None:
    """'1/10/2024 23:58:00' → '2024-01-10'."""
    s = s.split(" ")[0].strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%-m/%-d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def post_batch(env: dict[str, str], batch: list[dict], dry: bool) -> int:
    if dry:
        print(f"  dry-run: would post {len(batch)} records")
        return len(batch)
    import requests
    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/admin/bulk-rates"
    headers = {
        "Authorization": f"Bearer {env['SYNC_TOKEN']}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json={"rates": batch}, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json().get("inserted", 0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env = assert_env("CF_WORKER_URL", "SYNC_TOKEN", "GOOGLE_RATES_HISTORY_CSV")

    print(f"▶ fetch history CSV…")
    text = fetch_history_csv(env["GOOGLE_RATES_HISTORY_CSV"])
    print(f"  got {len(text):,} bytes")

    by_date = parse_history(text)
    print(f"▶ parsed {len(by_date)} dates")

    payload: list[dict] = []
    for iso in sorted(by_date.keys()):
        for quote, rate in by_date[iso].items():
            payload.append({
                "date": iso, "base": "EUR", "quote": quote,
                "rate": rate, "source": RATE_SOURCE,
            })
    print(f"▶ total records: {len(payload)}")

    if not payload:
        print("nothing to post."); return 0

    BATCH = 500
    total = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        n = post_batch(env, chunk, args.dry_run)
        total += n
        print(f"  batch {i // BATCH + 1}: posted {len(chunk)}, inserted {n}")
        time.sleep(0.15)
    print(f"\n✓ total inserted: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
