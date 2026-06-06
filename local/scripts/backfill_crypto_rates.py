#!/usr/bin/env python3
"""backfill_crypto_rates.py — однократная загрузка истории ETH/EUR в D1 (SPEC-026).

Источник — публичный Binance API (klines, дневные бары), симметрично
`backfill_rates.py` для фиата. GOOGLEFINANCE крипту не умеет, поэтому курсы ETH
приходят с Binance: cron пишет «сегодня», этот скрипт — историю (нужна для P&L
по дате покупки и спарклайна стоимости).

Семантика rates — «1 EUR = rate × quote». Binance ETHEUR (close) = EUR за 1 ETH,
поэтому ИНВЕРТИРУЕМ: rate = 1 / close. Постим в /v1/admin/bulk-rates пачками,
source='binance', idempotent (INSERT OR REPLACE по (date,base,quote)).

Usage:
    python local/scripts/backfill_crypto_rates.py                 # с 2024-01-10 до сегодня
    python local/scripts/backfill_crypto_rates.py --from 2024-01-10
    python local/scripts/backfill_crypto_rates.py --symbol ETHEUR --quote ETH
    python local/scripts/backfill_crypto_rates.py --dry-run
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import assert_env  # noqa: E402

RATE_SOURCE = "binance"
BINANCE_KLINES = "https://api.binance.com/api/v3/klines"
DEFAULT_FROM = "2024-01-10"   # первая дата курсов в системе (паритет с фиатом)
PRICE_SANITY_MAX = 100_000    # close ETH/EUR должен быть в разумных пределах


def to_ms(iso: str) -> int:
    return int(datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)


def fetch_klines(symbol: str, start_ms: int, end_ms: int) -> list[list]:
    """Дневные бары Binance в диапазоне. Пагинация по 1000 (лимит API)."""
    import requests
    out: list[list] = []
    cur = start_ms
    while cur <= end_ms:
        r = requests.get(
            BINANCE_KLINES,
            params={"symbol": symbol, "interval": "1d", "startTime": cur, "endTime": end_ms, "limit": 1000},
            timeout=60,
        )
        if r.status_code != 200:
            raise SystemExit(f"binance klines http {r.status_code}: {r.text[:200]}")
        batch = r.json()
        if not batch:
            break
        out.extend(batch)
        last_open = batch[-1][0]
        nxt = last_open + 86_400_000   # +1 день
        if nxt <= cur:
            break
        cur = nxt
        time.sleep(0.2)   # вежливо к public API
    return out


def parse_klines(klines: list[list], quote: str) -> list[dict]:
    """[[openTime, open, high, low, close, ...], ...] → записи rates (инверсия close)."""
    seen: set[str] = set()
    records: list[dict] = []
    for k in klines:
        open_ms, close_px = k[0], k[4]
        iso = datetime.fromtimestamp(open_ms / 1000, tz=timezone.utc).date().isoformat()
        if iso in seen:
            continue
        try:
            close = float(close_px)
        except (TypeError, ValueError):
            continue
        if not (0 < close < PRICE_SANITY_MAX):
            continue
        seen.add(iso)
        records.append({"date": iso, "base": "EUR", "quote": quote, "rate": 1.0 / close, "source": RATE_SOURCE})
    return records


def post_batch(env: dict[str, str], batch: list[dict], dry: bool) -> int:
    if dry:
        print(f"  dry-run: would post {len(batch)} records")
        return len(batch)
    import requests
    url = env["CF_WORKER_URL"].rstrip("/") + "/v1/admin/bulk-rates"
    headers = {"Authorization": f"Bearer {env['SYNC_TOKEN']}", "Content-Type": "application/json"}
    r = requests.post(url, json={"rates": batch}, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json().get("inserted", 0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--from", dest="from_date", default=DEFAULT_FROM, help="ISO start date (default 2024-01-10)")
    ap.add_argument("--to", dest="to_date", default=None, help="ISO end date (default today)")
    ap.add_argument("--symbol", default="ETHEUR", help="Binance symbol (default ETHEUR)")
    ap.add_argument("--quote", default="ETH", help="quote-валюта в rates (default ETH)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env = assert_env("CF_WORKER_URL", "SYNC_TOKEN")
    to_date = args.to_date or datetime.now(timezone.utc).date().isoformat()

    print(f"▶ fetch Binance klines {args.symbol} {args.from_date}..{to_date}…")
    klines = fetch_klines(args.symbol, to_ms(args.from_date), to_ms(to_date))
    print(f"  got {len(klines)} daily bars")

    payload = parse_klines(klines, args.quote)
    print(f"▶ parsed {len(payload)} {args.quote}/EUR records (close inverted → rate)")
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
