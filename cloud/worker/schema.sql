-- D1 schema (текущий снапшот после миграций 0001-0006).
-- Source of truth для всех финансовых данных (ADR-011).
-- Для свежей базы — применить этот файл; для существующей — миграции из migrations/.

-- ─── Whitelist Telegram-пользователей (ADR-009) ────────────────────────────
CREATE TABLE IF NOT EXISTS authorized_users (
    telegram_id   TEXT PRIMARY KEY,
    name          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Справочники ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,                  -- 'bank' | 'cash' | 'crypto' | 'external'
    currency    TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    color       TEXT,
    form        TEXT NOT NULL DEFAULT 'digital', -- 'cash' | 'digital' | 'external'
    sort_order  INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,                   -- 'expense' | 'income'
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

-- ─── Transactional: расходы ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
    id                TEXT PRIMARY KEY,           -- UUID v4 от Mini App
    user_id           TEXT NOT NULL,              -- Telegram user ID
    date              TEXT NOT NULL,              -- YYYY-MM-DD
    account_id        TEXT REFERENCES accounts(id),
    amount            REAL NOT NULL,
    currency          TEXT NOT NULL,
    category_id       TEXT REFERENCES categories(id),
    note              TEXT,
    source            TEXT NOT NULL DEFAULT 'mini_app',
    source_record_id  TEXT,                       -- идемпотентность импортов
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_active   ON expenses(date) WHERE deleted_at IS NULL;

-- ─── Курсы валют (ADR-006) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates (
    date        TEXT NOT NULL,                   -- YYYY-MM-DD
    base        TEXT NOT NULL DEFAULT 'EUR',
    quote       TEXT NOT NULL,
    rate        REAL NOT NULL,                   -- 1 base = rate * quote
    source      TEXT NOT NULL DEFAULT 'google-sheets',
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, base, quote)
);
CREATE INDEX IF NOT EXISTS idx_rates_quote_date ON rates(quote, date);

-- ─── Снапшоты балансов (Stage 5) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
    id          TEXT PRIMARY KEY,                -- UUID v4
    date        TEXT NOT NULL,                    -- YYYY-MM-DD
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    amount      REAL NOT NULL,                    -- в native currency аккаунта
    note        TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_date         ON snapshots(date);
CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON snapshots(account_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_active_date  ON snapshots(date) WHERE deleted_at IS NULL;
