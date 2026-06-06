-- 0015_investments_staking.sql — SPEC-027 (итерация 2 инвестиций)
--
-- 1) Частичный стейкинг: staked_qty = сколько единиц актива в стейкинге.
--    is_staked становится производным (staked_qty > 0); поле в схеме оставлено (legacy).
--    staking_apr_pct теперь = ручной override (NULL = авто-APR с Lido).
-- 2) app_config: глобальный key/value. Храним авто-APR stETH с публичного Lido API
--    (cron + refresh-rates), под будущие глобальные значения.
--
-- Применение: backup → wrangler d1 execute finances-outbox --remote --file этот_файл
-- (NOT migrations apply). Повторный прогон ADD COLUMN упадёт (колонка уже есть) — это норма.

ALTER TABLE investment_settings ADD COLUMN staked_qty REAL CHECK (staked_qty IS NULL OR staked_qty >= 0);

CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
