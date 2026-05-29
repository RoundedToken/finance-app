#!/usr/bin/env python3
"""backup_d1.py — backup Cloudflare D1 в локальный SQL-файл.

После D1-centric pivot D1 — источник правды. MacBook просто хранит резервные
копии. Запускается через launchd раз в день. Bonus: копирует в iCloud Drive
если папка существует.

Usage:
    python local/scripts/backup_d1.py
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import BACKUPS_DIR, ROOT  # noqa: E402

WRANGLER = "/opt/homebrew/bin/wrangler"
ICLOUD_DIR = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/finances-backups"
KEY_TABLES = ("expenses", "snapshots", "incomes", "transactions", "rates", "accounts")


def verify_dump(path: Path) -> tuple[bool, str]:
    """Фаза 1.7: импортирует дамп в temp-sqlite и проверяет, что ключевые таблицы
    есть и непусты. D1 — единственная живая копия; «успешный» экспорт пустого/
    обрезанного дампа иначе прошёл бы молча и вскрылся лишь в момент катастрофы."""
    try:
        sql = path.read_text()
    except Exception as e:
        return False, f"не прочитать дамп: {e}"
    counts: dict[str, "int | None"] = {}
    try:
        with tempfile.TemporaryDirectory() as td:
            conn = sqlite3.connect(str(Path(td) / "verify.db"))
            try:
                conn.executescript(sql)
                for t in KEY_TABLES:
                    try:
                        counts[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                    except sqlite3.OperationalError:
                        counts[t] = None
            finally:
                conn.close()
    except Exception as e:
        return False, f"импорт дампа упал: {e}"
    missing = [t for t, c in counts.items() if c is None]
    if missing:
        return False, f"таблицы отсутствуют: {missing} (counts={counts})"
    if (counts.get("expenses") or 0) == 0 or (counts.get("rates") or 0) == 0:
        return False, f"подозрительно пустой дамп: {counts}"
    return True, f"ok {counts}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db-name", default="finances-outbox", help="имя D1 базы")
    ap.add_argument("--keep", type=int, default=30, help="сколько копий хранить локально")
    args = ap.parse_args()

    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    out = BACKUPS_DIR / f"d1-{args.db_name}.{ts}.sql"

    config = ROOT / "cloud" / "worker" / "wrangler.toml"
    cmd = [WRANGLER, "--config", str(config), "d1", "export", args.db_name, "--remote", "--output", str(out)]
    print(" ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + "\n" + r.stderr + "\n")
        return r.returncode
    print(f"✓ wrote {out} ({out.stat().st_size:,} bytes)")

    # Фаза 1.7: проверка восстановимости ДО распространения в iCloud.
    ok, detail = verify_dump(out)
    if not ok:
        sys.stderr.write(f"BACKUP VERIFY FAILED: {detail}\n")
        return 2
    print(f"✓ verify: {detail}")

    # size-drop sanity: предупреждаем, если дамп резко меньше предыдущего.
    prev = [b for b in sorted(BACKUPS_DIR.glob(f"d1-{args.db_name}.*.sql")) if b != out]
    if prev and out.stat().st_size < prev[-1].stat().st_size * 0.5:
        sys.stderr.write(f"WARN: дамп вдвое меньше предыдущего ({out.stat().st_size:,} < {prev[-1].stat().st_size:,}) — проверь экспорт\n")

    # iCloud копия — если папка существует.
    if ICLOUD_DIR.exists():
        icloud_out = ICLOUD_DIR / out.name
        shutil.copy2(out, icloud_out)
        print(f"✓ icloud copy: {icloud_out}")
    else:
        print(f"  (iCloud folder not found at {ICLOUD_DIR}; skipping)")

    # rotation: keep last N
    backups = sorted(BACKUPS_DIR.glob(f"d1-{args.db_name}.*.sql"))
    if len(backups) > args.keep:
        for old in backups[: -args.keep]:
            old.unlink()
            print(f"  removed old: {old.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
