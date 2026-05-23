-- Schema for Cloudflare D1 (outbox/buffer).
-- Применяется при первом deploy через:
--   wrangler d1 execute finances-outbox --file=schema.sql
--
-- D1 НЕ хранит историческое — только последние N дней транзита.
-- Cron Trigger в воркере чистит подтверждённые записи старше 7 дней.

-- Не-засинхронизированные траты с iPhone
CREATE TABLE IF NOT EXISTS expenses_outbox (
    id            TEXT PRIMARY KEY,         -- UUID v4 от Mini App
    user_id       TEXT NOT NULL,            -- Telegram user ID
    date          TEXT NOT NULL,
    account_id    TEXT,                     -- из bootstrap (может быть NULL пока)
    amount        REAL NOT NULL,
    currency      TEXT NOT NULL,
    category_id   TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL,            -- момент ввода в Mini App
    confirmed_at  TEXT                      -- MacBook подтвердил приём
);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON expenses_outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_confirmed ON expenses_outbox(confirmed_at);
CREATE INDEX IF NOT EXISTS idx_outbox_user ON expenses_outbox(user_id);

-- Whitelist пользователей — только они могут писать
CREATE TABLE IF NOT EXISTS authorized_users (
    telegram_id   TEXT PRIMARY KEY,
    name          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Справочники: read-only для Mini App, обновляются push-командой с MacBook
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    currency    TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    color       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    parent_id   TEXT,
    emoji       TEXT,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS currencies (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT,
    is_crypto   INTEGER NOT NULL DEFAULT 0,
    decimals    INTEGER NOT NULL DEFAULT 2
);

-- Simple rate limit bucket (для защиты от спама)
CREATE TABLE IF NOT EXISTS rate_limit (
    user_id      TEXT NOT NULL,
    window_start TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, window_start)
);
