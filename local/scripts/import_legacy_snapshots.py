#!/usr/bin/env python3
"""import_legacy_snapshots.py — импорт истории снапшотов из data/legacy/Finances.xlsx.

Значения в xlsx хранятся в EUR-эквиваленте (колонка Total = сумма корзин — это
подтверждает единую валюту). Снапшоты в D1 живут в native-валюте корзины, поэтому
конвертируем EUR → native по историческому курсу из D1 (rates dump). Round-trip
честный: дашборд сконвертит обратно и покажет те же EUR.

Идемпотентно: UUID5 по (account_id, date) → повторный запуск ничего не дублирует
(INSERT OR IGNORE). source='manual' — чтобы снимки работали как baseline для
effective_balance (см. snapshots.ts). Происхождение — в note.

Заливается НЕ напрямую (D1 — источник правды, ADR-011): скрипт генерит SQL,
который применяется через `wrangler d1 execute --file --remote`.

Usage:
  python local/scripts/import_legacy_snapshots.py --rates /tmp/legacy_rates.json --dry-run
  python local/scripts/import_legacy_snapshots.py --rates /tmp/legacy_rates.json --out /tmp/legacy_snapshots.sql
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

XLSX = Path(__file__).resolve().parent.parent.parent / "data" / "legacy" / "Finances.xlsx"

# Отдельный namespace (не пересекается с import_ok_csv expenses).
NAMESPACE = uuid.UUID("a1b2c3d4-0000-3333-4444-000000000000")

# Balance-колонка (0-based индекс в строке) каждой корзины → (account_id, currency).
# col 25 (Total) намеренно отсутствует — это сумма, не корзина.
BUCKET_COLS: dict[int, tuple[str, str]] = {
    1:  ("rsd-bank",         "RSD"),   # Serbian banks RSD
    5:  ("eur-bank",         "EUR"),   # Serbian banks EUR
    9:  ("rub-bank",         "RUB"),   # Russian banks RUB
    13: ("usdt",             "USDT"),  # OKX USDT
    17: ("eur-cash",         "EUR"),   # Cash EUR
    21: ("acc_money_ok_rsd", "RSD"),   # Cash RSD
}

# Строки без проставленной даты (подтверждено пользователем 2026-05-25).
MISSING_DATES: dict[int, str] = {19: "2025-07-15", 20: "2025-08-01", 21: "2025-08-15"}


def build_rate_index(rows: list[dict]) -> dict[str, list[tuple[str, float]]]:
    idx: dict[str, list[tuple[str, float]]] = {}
    for r in rows:
        idx.setdefault(r["quote"], []).append((r["date"], float(r["rate"])))
    for q in idx:
        idx[q].sort()
    return idx


def rate_at(idx: dict[str, list[tuple[str, float]]], quote: str, date: str) -> float | None:
    """Курс EUR→quote на дату (ближайший с date ≤ target). EUR→1."""
    if quote == "EUR":
        return 1.0
    arr = idx.get(quote, [])
    lo, hi, ans = 0, len(arr) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid][0] <= date:
            ans = arr[mid][1]
            lo = mid + 1
        else:
            hi = mid - 1
    return ans


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rates", type=Path, required=True, help="JSON dump из `wrangler d1 execute ... --json`")
    ap.add_argument("--out", type=Path, help="куда писать SQL (если не задан — dry-run)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    raw = json.loads(args.rates.read_text())
    rate_rows = raw[0]["results"] if isinstance(raw, list) and raw and "results" in raw[0] else raw
    idx = build_rate_index(rate_rows)

    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["Sheet1"]
    rows = list(ws.iter_rows(values_only=True))

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out: list[str] = []
    stats = {"snapshots": 0, "skipped_empty": 0, "no_rate": 0, "dates": set()}
    sample: list[str] = []

    for i in range(2, len(rows)):
        row = rows[i]
        d = row[0]
        if isinstance(d, datetime):
            date = d.strftime("%Y-%m-%d")
        elif i in MISSING_DATES:
            date = MISSING_DATES[i]
        else:
            continue  # строка без даты и не в списке восстановленных
        stats["dates"].add(date)

        for col, (acc, ccy) in BUCKET_COLS.items():
            eur = row[col]
            if not isinstance(eur, (int, float)):
                stats["skipped_empty"] += 1
                continue
            if ccy == "EUR":
                native = float(eur)
            else:
                r = rate_at(idx, ccy, date)
                if r is None:
                    stats["no_rate"] += 1
                    sys.stderr.write(f"нет курса {ccy} на {date}\n")
                    continue
                native = float(eur) * r
            native = round(native, 2)

            sid = str(uuid.uuid5(NAMESPACE, f"legacy|{acc}|{date}"))
            note = sql_escape("импорт из Finances.xlsx")
            out.append(
                "INSERT OR IGNORE INTO snapshots "
                "(id,date,account_id,amount,note,source,created_at,updated_at) "
                f"VALUES ('{sid}','{date}','{acc}',{native},'{note}','manual','{now}','{now}');"
            )
            stats["snapshots"] += 1
            if len(sample) < 12:
                sample.append(f"  {date} {acc:18} {ccy:4} eur={eur:>9.2f} → native={native:>12.2f}")

    print(f"снапшотов:        {stats['snapshots']}")
    print(f"дат:              {len(stats['dates'])}  ({min(stats['dates'])} → {max(stats['dates'])})")
    print(f"пустых ячеек:     {stats['skipped_empty']}")
    print(f"без курса:        {stats['no_rate']}")
    print("\nпример конверсии:")
    print("\n".join(sample))

    if args.dry_run or not args.out:
        print("\n(dry-run — SQL не записан)")
        return 0

    args.out.write_text("\n".join(out) + "\n")
    print(f"\nSQL записан: {args.out}  ({len(out)} statements)")
    print("Применить: wrangler d1 execute finances-outbox --remote --file=" + str(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
