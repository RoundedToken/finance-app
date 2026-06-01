-- 0012_adaptive_budgets.sql — SPEC-023: адаптивные бюджеты (RBAR)
-- Применение: wrangler d1 execute finances-outbox --file=migrations/0012_adaptive_budgets.sql --remote
--
-- Добавляет:
--   - budget_settings: per-category override'ы (архетип, ручной пол, вкл/выкл
--     адаптации). Состояние оценщика (B_lvl/B_trd/streak) НЕ хранится — оно
--     переигрывается из expenses при каждом запросе (SPEC-023 §5, G6).
--   - budget_recommendation_log: аудит-лог принятых/скрытых рекомендаций
--     (advisory accept/dismiss + будущий авто-режим). Append-only.
-- Существующие таблицы не меняются.

CREATE TABLE IF NOT EXISTS budget_settings (
    category_id        TEXT PRIMARY KEY REFERENCES categories(id),
    archetype_override TEXT CHECK (archetype_override IN
                          ('fixed','recurring','seasonal','lumpy','intermittent')),  -- NULL = авто
    floor_eur          REAL CHECK (floor_eur >= 0),     -- ручной абсолютный пол лимита; NULL = авто (0.6·median)
    adaptive_enabled   INTEGER NOT NULL DEFAULT 1,      -- 1 = считать рекомендации; 0 = только ручной лимит SPEC-020
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_recommendation_log (
    id              TEXT PRIMARY KEY,                    -- UUID
    category_id     TEXT NOT NULL REFERENCES categories(id),
    period          TEXT NOT NULL,                       -- "YYYY-MM" месяц, НА который рекомендация
    archetype       TEXT NOT NULL,
    prev_limit_eur  REAL,                                -- лимит до (NULL — лимита не было)
    reco_limit_eur  REAL NOT NULL,
    reason_code     TEXT NOT NULL,                       -- SAVINGS_STREAK | TRACKING_DOWN | TRACKING_UP |
                                                         -- HOLD | HOLD_AFTER_BREACH | ROLLBACK | FLOOR_HIT | COLD_START
    decision        TEXT NOT NULL DEFAULT 'pending'
                       CHECK (decision IN ('pending','accepted','dismissed')),
    decided_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reco_log_cat_period
    ON budget_recommendation_log(category_id, period);
