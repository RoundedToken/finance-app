-- Stage 5 — модель «валюта × форма» (cash/digital) и таблица snapshots.
-- Стратегия: старые 2 accounts сохраняются (на них висят 1822 expenses).
-- - `external` — pseudo-account для трат без источника, помечаем form='external', is_active=0.
-- - `acc_money_ok_rsd` — реальный RSD cash, переименовываем в bucket «RSD · нал».
-- Добавляем 6 новых вёдер (RUB digital, RSD digital, EUR digital/cash, USDT, TRY cash).
-- Создаём таблицу snapshots.

-- ─── 1. Расширяем accounts ─────────────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN form TEXT NOT NULL DEFAULT 'digital';
ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;

-- ─── 2. Маркируем старые ───────────────────────────────────────────────────
UPDATE accounts SET form = 'external', is_active = 0
 WHERE id = 'external';

UPDATE accounts
   SET form = 'cash',
       name = 'RSD · нал',
       type = 'cash',
       sort_order = 30,
       color = '#fbbf24'
 WHERE id = 'acc_money_ok_rsd';

-- ─── 3. Новые 6 вёдер ──────────────────────────────────────────────────────
INSERT INTO accounts (id, name, type, currency, is_active, form, sort_order, color)
VALUES
    ('rub-bank', 'RUB · банк', 'bank',  'RUB',  1, 'digital', 10, '#a78bfa'),
    ('rsd-bank', 'RSD · банк', 'bank',  'RSD',  1, 'digital', 20, '#fdba74'),
    ('eur-bank', 'EUR · банк', 'bank',  'EUR',  1, 'digital', 40, '#34d399'),
    ('eur-cash', 'EUR · нал',  'cash',  'EUR',  1, 'cash',    50, '#86efac'),
    ('usdt',     'USDT',       'crypto','USDT', 1, 'digital', 60, '#22d3ee'),
    ('try-cash', 'TRY · нал',  'cash',  'TRY',  1, 'cash',    70, '#fb7185');

-- ─── 4. Добавляем валюту TRY (если ещё нет) ────────────────────────────────
INSERT OR IGNORE INTO currencies (code, name, emoji, is_crypto, decimals)
VALUES ('TRY', 'Турецкая лира', '🇹🇷', 0, 2);

-- ─── 5. Таблица snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
    id          TEXT PRIMARY KEY,                    -- UUID v4
    date        TEXT NOT NULL,                        -- YYYY-MM-DD (на какую дату фиксируем баланс)
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    amount      REAL NOT NULL,                        -- в native currency аккаунта
    note        TEXT,                                 -- свободное описание ("зарплата", "обмен USDT→EUR", ...)
    source      TEXT NOT NULL DEFAULT 'manual',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date         ON snapshots(date);
CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON snapshots(account_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_active_date  ON snapshots(date) WHERE deleted_at IS NULL;
