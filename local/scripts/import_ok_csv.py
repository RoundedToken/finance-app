#!/usr/bin/env python3
"""import_ok_csv.py — миграция исторических трат из CSV «Расходы ОК».

Идемпотентен: deterministic UUID на основе hash(line_no + дата + сумма + ...),
повторный запуск ничего не дублирует (INSERT OR IGNORE по id).

Usage:
    python local/scripts/import_ok_csv.py
    python local/scripts/import_ok_csv.py --dry-run
    python local/scripts/import_ok_csv.py --file path/to/MoneyOK.csv
"""
from __future__ import annotations

import argparse
import csv
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import ROOT, db_connect  # noqa: E402

DEFAULT_CSV = ROOT / "data" / "money-ok" / "MoneyOK.csv"
DEFAULT_ACCOUNT = "acc_money_ok_rsd"
DEFAULT_CURRENCY = "RSD"

# Маппинг русских названий статей из CSV → semantic id в нашей таблице categories.
CATEGORY_MAP: dict[str, str] = {
    "Еда": "food",
    "Продукты": "groceries",
    "Кафе": "cafe",
    "Транспорт": "transport",
    "Спорт": "sport",
    "Жилье": "housing",
    "Жильё": "housing",
    "Коммуналка": "utilities",
    "Здоровье": "health",
    "Техника": "electronics",
    "Досуг": "leisure",
    "Одежда": "clothing",
    "Красота": "beauty",
    "Дом": "home",
    "Подарки": "gifts",
    "Образование": "education",
    "Поездки": "travel",
    "Подписки": "subscriptions",
    "Связь и подписки": "subscriptions",
    "Комиссии": "fees",
    "Чаевые": "tips",
    "Отпуск|путешествия": "travel",
    "Гос услуги": "government",
    "Долги": "debts",
    "🔞": "adult",
}

# Фиксированный namespace для UUID5 → одни и те же входные данные дают тот же UUID.
NAMESPACE = uuid.UUID("a1b2c3d4-0000-1111-2222-000000000000")


def deterministic_id(line_no: int, raw: dict) -> str:
    parts = [
        str(line_no),
        raw.get("Дата", ""),
        raw.get("Сумма", ""),
        raw.get("Статья", ""),
        raw.get("Комментарий", ""),
    ]
    return str(uuid.uuid5(NAMESPACE, "|".join(parts)))


def parse_date(s: str) -> str | None:
    """'2026.05.22' → '2026-05-22'."""
    s = s.strip().strip('"')
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y.%m.%d").date().isoformat()
    except ValueError:
        return None


def parse_amount(s: str) -> float | None:
    s = s.strip().strip('"')
    if not s:
        return None
    try:
        return abs(float(s.replace(",", ".")))
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--account", default=DEFAULT_ACCOUNT)
    ap.add_argument("--currency", default=DEFAULT_CURRENCY)
    args = ap.parse_args()

    if not args.file.exists():
        sys.stderr.write(f"ERROR: file not found: {args.file}\n")
        return 1

    conn = db_connect()

    # Sanity: account и currency должны быть в справочниках.
    if not conn.execute("SELECT 1 FROM accounts WHERE id = ?", (args.account,)).fetchone():
        sys.stderr.write(
            f"ERROR: account '{args.account}' not in DB.\n"
            f"Apply migration 003_seed_for_ok_import first: python local/scripts/init_db.py\n"
        )
        return 1
    if not conn.execute("SELECT 1 FROM currencies WHERE code = ?", (args.currency,)).fetchone():
        sys.stderr.write(f"ERROR: currency '{args.currency}' not in DB.\n")
        return 1

    stats = {
        "read": 0,
        "skipped_invalid": 0,
        "skipped_existing": 0,
        "inserted": 0,
        "skipped_income": 0,  # положительные суммы — это доходы, для них нужен другой flow
        "unknown_categories": {},
    }
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cur = conn.cursor()

    with open(args.file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for line_no, row in enumerate(reader, start=2):
            stats["read"] += 1

            raw_amount = (row.get("Сумма", "") or "").strip().strip('"')
            try:
                amount_signed = float(raw_amount.replace(",", "."))
            except (ValueError, AttributeError):
                stats["skipped_invalid"] += 1
                continue

            # В «Расходы ОК» расходы записаны со знаком "-". Положительные суммы
            # появляются редко и означают income/возвраты — на этом импорте их пропускаем,
            # для них нужна отдельная логика (тип transaction = 'income').
            if amount_signed >= 0:
                stats["skipped_income"] += 1
                continue
            amount = abs(amount_signed)

            date = parse_date(row.get("Дата", ""))
            if not date:
                stats["skipped_invalid"] += 1
                continue

            statya = (row.get("Статья", "") or "").strip().strip('"')
            comment = (row.get("Комментарий", "") or "").strip().strip('"')
            csv_currency = (row.get("Валюта", "") or "").strip().strip('"')
            currency = csv_currency or args.currency

            cat_id = CATEGORY_MAP.get(statya)
            if not cat_id:
                cat_id = "other"
                stats["unknown_categories"][statya] = stats["unknown_categories"].get(statya, 0) + 1

            txn_id = deterministic_id(line_no, row)
            if args.dry_run:
                stats["inserted"] += 1
                continue

            try:
                cur.execute(
                    """
                    INSERT OR IGNORE INTO expenses
                        (id, date, account_id, amount, currency, category_id,
                         note, source, source_record_id, created_at, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_ok_import', ?, ?, ?)
                    """,
                    (
                        txn_id,
                        date,
                        args.account,
                        amount,
                        currency,
                        cat_id,
                        comment or None,
                        f"line:{line_no}",
                        f"{date}T00:00:00Z",
                        now_iso,
                    ),
                )
                if cur.rowcount > 0:
                    stats["inserted"] += 1
                else:
                    stats["skipped_existing"] += 1
            except Exception as e:
                sys.stderr.write(f"line {line_no} failed: {e}\n")
                stats["skipped_invalid"] += 1

    if not args.dry_run:
        conn.commit()

    print(f"read:              {stats['read']}")
    print(f"inserted:          {stats['inserted']}{'  (dry-run)' if args.dry_run else ''}")
    print(f"skipped existing:  {stats['skipped_existing']}")
    print(f"skipped invalid:   {stats['skipped_invalid']}")
    print(f"skipped income:    {stats['skipped_income']}")
    if stats["unknown_categories"]:
        print("\nstatyas без маппинга → 'other':")
        for k, v in sorted(stats["unknown_categories"].items(), key=lambda x: -x[1]):
            print(f"  {v:5d}× {k!r}")
        print("\nДобавить их в CATEGORY_MAP в этом скрипте и в local/migrations/ "
              "(новая миграция), потом ре-импорт.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
