"""Общие утилиты для local-скриптов."""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
LOCAL_DIR = ROOT / "local"
DB_PATH = LOCAL_DIR / "finances.db"
SCHEMA_PATH = LOCAL_DIR / "schema.sql"
MIGRATIONS_DIR = LOCAL_DIR / "migrations"
BACKUPS_DIR = LOCAL_DIR / "backups"
LOGS_DIR = LOCAL_DIR / "logs"
ENV_PATH = ROOT / ".env"

# GCP service account для Google Sheets-прокси к курсам (см. docs/setup.md §7).
# Канонический путь — менять одновременно с инструкцией.
GSHEETS_KEY_PATH = Path.home() / ".config" / "finances-gsheets" / "key.json"


def load_env() -> dict[str, str]:
    """Простой загрузчик .env (без сторонних библиотек на bootstrap-стадии)."""
    env: dict[str, str] = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("'\"")
    return env


def db_connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Открывает соединение с локальной БД с включёнными FK + WAL."""
    if not path.exists():
        sys.stderr.write(
            f"ERROR: database not found at {path}\n"
            f"Run: python local/scripts/init_db.py\n"
        )
        sys.exit(1)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_sync_state(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM sync_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_sync_state(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        """,
        (key, value),
    )


def assert_env(*required: str) -> dict[str, str]:
    """Загружает .env и проверяет наличие нужных ключей."""
    env = load_env()
    # Поверх .env — реальные env-vars (например, в launchd)
    for k in required:
        if k in os.environ:
            env[k] = os.environ[k]
    missing = [k for k in required if k not in env]
    if missing:
        sys.stderr.write(
            f"ERROR: missing env vars: {', '.join(missing)}\n"
            f"Set them in {ENV_PATH} or export in shell.\n"
        )
        sys.exit(1)
    return env
