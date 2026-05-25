-- D1 schema (текущий снапшот после миграций 0001-0008).
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

-- ─── Категории доходов (Stage 6) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS income_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Доходы (Stage 6) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incomes (
    id            TEXT PRIMARY KEY,
    date          TEXT NOT NULL,
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    amount        REAL NOT NULL CHECK (amount > 0),
    currency_code TEXT NOT NULL REFERENCES currencies(code),
    category_id   TEXT NOT NULL REFERENCES income_categories(id),
    source        TEXT,
    note          TEXT,
    goal_id       TEXT REFERENCES goals(id),       -- Stage 7
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_incomes_date         ON incomes(date);
CREATE INDEX IF NOT EXISTS idx_incomes_account_date ON incomes(account_id, date);
CREATE INDEX IF NOT EXISTS idx_incomes_category     ON incomes(category_id);
CREATE INDEX IF NOT EXISTS idx_incomes_active_date  ON incomes(date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_incomes_goal         ON incomes(goal_id);

-- ─── Цели / целевые фонды (Stage 7) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    emoji           TEXT,
    color           TEXT,
    target_amount   REAL CHECK (target_amount IS NULL OR target_amount > 0),
    target_currency TEXT REFERENCES currencies(code),
    deadline        TEXT,
    note            TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_active ON goals(status, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS goal_contributions (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT NOT NULL REFERENCES goals(id),
    date            TEXT NOT NULL,
    amount          REAL NOT NULL CHECK (amount > 0),
    currency_code   TEXT NOT NULL REFERENCES currencies(code),
    account_id      TEXT REFERENCES accounts(id),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_goal   ON goal_contributions(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_date   ON goal_contributions(date);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_active ON goal_contributions(goal_id, date) WHERE deleted_at IS NULL;
