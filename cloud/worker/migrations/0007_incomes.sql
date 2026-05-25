-- 0007_incomes.sql — Stage 6: Доходы (SPEC-006)
--
-- Добавляет:
--   - income_categories: справочник из 6 базовых категорий
--   - incomes: транзакционная таблица доходов
--
-- См. SPEC-006 §5 для семантики полей.

-- ─── Справочник категорий доходов ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS income_categories (
    id          TEXT PRIMARY KEY,                  -- стабильный slug
    name        TEXT NOT NULL,
    emoji       TEXT,
    color       TEXT,                              -- hex, #RRGGBB
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO income_categories (id, name, emoji, color, sort_order) VALUES
    ('salary',    'Зарплата',                       '💼', '#a78bfa', 10),
    ('interest',  'Проценты',                       '📈', '#34d399', 20),
    ('gifts',     'Подарки',                        '🎁', '#f9a8d4', 30),
    ('cashback',  'Выигрыши / Cashback / возвраты', '🎟️', '#fbbf24', 40),
    ('freelance', 'Freelance',                      '💻', '#22d3ee', 50),
    ('other',     'Прочее',                         '✨', '#94a3b8', 60);

-- ─── Доходы ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incomes (
    id            TEXT PRIMARY KEY,
    date          TEXT NOT NULL,                                -- YYYY-MM-DD
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    amount        REAL NOT NULL CHECK (amount > 0),             -- native currency аккаунта
    currency_code TEXT NOT NULL REFERENCES currencies(code),    -- денормализация из accounts.currency
    category_id   TEXT NOT NULL REFERENCES income_categories(id),
    source        TEXT,                                          -- «Anthropic», «Родители»
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_incomes_date         ON incomes(date);
CREATE INDEX IF NOT EXISTS idx_incomes_account_date ON incomes(account_id, date);
CREATE INDEX IF NOT EXISTS idx_incomes_category     ON incomes(category_id);
CREATE INDEX IF NOT EXISTS idx_incomes_active_date  ON incomes(date) WHERE deleted_at IS NULL;
