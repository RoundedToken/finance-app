-- 0014_investments.sql — SPEC-026: инвестиции (крипто-портфель ETH/стейкинг)
--
-- Холдинг ETH = обычное ведро (account). Раздел «Инвестиции» = аналитическая
-- линза поверх (cost basis из exchange-истории, стоимость из rates, доход
-- стейкинга из снапшотов). Новое в схеме — минимум:
--   1) валюта ETH в справочник (stETH НЕ добавляем — пег к ETH 1:1, Q4/NG1);
--   2) accounts.is_investment — ведро-актив входит в net worth, но исключается
--      из свободных (free = net − targeted − invested);
--   3) seed инвест-ведра eth-invest;
--   4) уникальный индекс «одна позиция на валюту» (G2);
--   5) investment_settings — APR стейкинга (для прогноза) + признак «застейкано».
-- Курсы ETH пишет cron (source='binance') и бэкфилл (bulk-rates) — таблица rates
-- не меняется (source — TEXT без CHECK, тег ставит приложение).
--
-- Применение: backup → wrangler d1 execute finances-outbox --remote --file этот_файл
-- (НЕ migrations apply — см. memory d1-migrations-apply-via-execute-file). Идемпотентно
-- кроме ADD COLUMN (повторный прогон ADD COLUMN упадёт — это норма, колонка уже есть).

-- 1) Валюта ETH (decimals=6 — как в CURRENCY_DECIMALS фронта)
INSERT OR IGNORE INTO currencies (code, name, emoji, is_crypto, decimals)
VALUES ('ETH', 'Ethereum', '⟠', 1, 6);

-- 2) Флаг инвест-ведра: входит в net, исключается из free (invested)
ALTER TABLE accounts ADD COLUMN is_investment INTEGER NOT NULL DEFAULT 0;

-- 3) Seed инвест-ведро для ETH (form='digital' → попадает в listBuckets/net worth)
INSERT OR IGNORE INTO accounts (id, name, type, currency, is_active, color, form, sort_order, is_investment)
VALUES ('eth-invest', 'ETH (инвест)', 'crypto', 'ETH', 1, '#627eea', 'digital', 90, 1);

-- 4) Инвариант «одна позиция на валюту» (G2): не более одного активного инвест-ведра на currency
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_investment_per_currency
    ON accounts(currency) WHERE is_investment = 1 AND deleted_at IS NULL;

-- 5) Настройки стейкинга на ведро (APR для прогноза, признак «застейкано»)
CREATE TABLE IF NOT EXISTS investment_settings (
    account_id        TEXT PRIMARY KEY REFERENCES accounts(id),
    is_staked         INTEGER NOT NULL DEFAULT 0,   -- 1 = позиция в стейкинге (Q4 признак)
    staking_apr_pct   REAL CHECK (staking_apr_pct IS NULL OR (staking_apr_pct >= 0 AND staking_apr_pct <= 100)), -- напр. 3.6
    note              TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
