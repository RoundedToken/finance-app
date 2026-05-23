-- D1 migration 0003: expenses table as ground truth.
-- После этого D1 — единственный источник правды. MacBook = backup only.

CREATE TABLE IF NOT EXISTS expenses (
    id               TEXT PRIMARY KEY,        -- UUID v4
    date             TEXT NOT NULL,           -- YYYY-MM-DD
    account_id       TEXT,                    -- nullable, references accounts(id)
    amount           REAL NOT NULL,
    currency         TEXT NOT NULL,
    category_id      TEXT,                    -- nullable, references categories(id)
    note             TEXT,
    source           TEXT NOT NULL,           -- 'mini_app','csv_ok_import','manual','migration'
    source_record_id TEXT,
    user_id          TEXT NOT NULL,           -- telegram id, owner of the record
    created_at       TEXT NOT NULL,           -- момент создания на клиенте
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at       TEXT                     -- soft delete
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_updated ON expenses(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_deleted ON expenses(deleted_at);

-- Owner whitelist уже есть в authorized_users.
-- accounts/categories/currencies уже есть как справочники.

-- Fix: USDT emoji вернуть к ₮ (буква T перечёркнутая).
UPDATE currencies SET emoji = '₮' WHERE code = 'USDT';
