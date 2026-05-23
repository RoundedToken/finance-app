#!/usr/bin/env python3
"""init_db.py — создаёт БД из миграций, либо применяет недостающие миграции.

Usage:
    python local/scripts/init_db.py            # создать / докатить миграции
    python local/scripts/init_db.py --reset    # удалить БД и создать заново
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import BACKUPS_DIR, DB_PATH, MIGRATIONS_DIR  # noqa: E402


def list_migrations() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def applied_migrations(conn: sqlite3.Connection) -> set[str]:
    try:
        rows = conn.execute("SELECT name FROM _migrations").fetchall()
        return {r[0] for r in rows}
    except sqlite3.OperationalError:
        return set()


def apply_migration(conn: sqlite3.Connection, path: Path) -> None:
    print(f"applying: {path.name}")
    sql = path.read_text()
    conn.executescript(sql)
    conn.commit()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reset", action="store_true", help="delete existing DB first")
    args = ap.parse_args()

    if args.reset and DB_PATH.exists():
        BACKUPS_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = BACKUPS_DIR / f"finances.before_reset.{ts}.db"
        shutil.copy2(DB_PATH, backup)
        print(f"backup before reset: {backup}")
        DB_PATH.unlink()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    applied = applied_migrations(conn)
    migrations = list_migrations()
    if not migrations:
        sys.stderr.write(f"ERROR: no migrations in {MIGRATIONS_DIR}\n")
        return 1

    new = [m for m in migrations if m.stem not in applied]
    if not new:
        print(f"up to date — {len(applied)} migrations applied")
        return 0

    for m in new:
        try:
            apply_migration(conn, m)
        except Exception as e:
            sys.stderr.write(f"FAILED on {m.name}: {e}\n")
            conn.rollback()
            return 2

    print(f"OK — applied {len(new)} new migration(s), total {len(applied) + len(new)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
