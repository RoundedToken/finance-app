-- D1 schema (текущий снапшот после миграций 0001-0011).
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

-- ─── Снапшоты балансов (Stage 5; +transaction_id Stage 7.5) ───────────────
CREATE TABLE IF NOT EXISTS snapshots (
    id              TEXT PRIMARY KEY,
    date            TEXT NOT NULL,
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    amount          REAL NOT NULL,
    note            TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',         -- 'manual' | 'auto_transaction'
    transaction_id  TEXT REFERENCES transactions(id),       -- Stage 7.5: cascade soft-delete
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_date         ON snapshots(date);
CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON snapshots(account_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_active_date  ON snapshots(date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_snapshots_transaction  ON snapshots(transaction_id);

-- ─── Транзакции (Stage 7.5) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL CHECK (type IN ('exchange','transfer')),
    date             TEXT NOT NULL,
    from_account_id  TEXT NOT NULL REFERENCES accounts(id),
    to_account_id    TEXT NOT NULL REFERENCES accounts(id),
    from_amount      REAL NOT NULL CHECK (from_amount > 0),
    from_currency    TEXT NOT NULL REFERENCES currencies(code),
    to_amount        REAL NOT NULL CHECK (to_amount > 0),
    to_currency      TEXT NOT NULL REFERENCES currencies(code),
    fee_amount       REAL CHECK (fee_amount IS NULL OR fee_amount >= 0),
    fee_currency     TEXT REFERENCES currencies(code),
    note             TEXT,
    chain_id         TEXT,
    chain_sequence   INTEGER,
    goal_id          TEXT REFERENCES goals(id),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_chain   ON transactions(chain_id, chain_sequence);
CREATE INDEX IF NOT EXISTS idx_transactions_from    ON transactions(from_account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_to      ON transactions(to_account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_active  ON transactions(date) WHERE deleted_at IS NULL;

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

-- ─── Бюджеты / лимиты по категориям (SPEC-020) ────────────────────────────
-- scope='category' → месячный лимит на расходную категорию (category_id NOT NULL);
-- scope='total'    → общий месячный потолок на все траты (category_id NULL).
-- Лимит в EUR, recurring (без истории по месяцам). Факт трат derived, не хранится.
CREATE TABLE IF NOT EXISTS budgets (
    id           TEXT PRIMARY KEY,
    scope        TEXT NOT NULL DEFAULT 'category' CHECK (scope IN ('category','total')),
    category_id  TEXT REFERENCES categories(id),
    limit_eur    REAL NOT NULL CHECK (limit_eur > 0),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at   TEXT,
    CHECK (
        (scope = 'category' AND category_id IS NOT NULL) OR
        (scope = 'total'    AND category_id IS NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id) WHERE deleted_at IS NULL AND category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_total    ON budgets(scope)       WHERE deleted_at IS NULL AND scope = 'total';
