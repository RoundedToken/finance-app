-- 0011_budgets.sql — Фаза 2 пост-MVP (SPEC-020): бюджеты/лимиты по категориям
--
-- Добавляет:
--   - budgets: месячный лимит (EUR) на расходную категорию (scope='category')
--              или общий потолок на все траты (scope='total'). Recurring,
--              без истории по месяцам. Факт трат НЕ хранится (derived). Soft-delete.
--
-- Применение (D1 не запускает миграции автоматически):
--   wrangler d1 execute finances-outbox --file=migrations/0011_budgets.sql --remote

CREATE TABLE IF NOT EXISTS budgets (
    id           TEXT PRIMARY KEY,                              -- UUID v4
    scope        TEXT NOT NULL DEFAULT 'category'
                   CHECK (scope IN ('category','total')),
    category_id  TEXT REFERENCES categories(id),               -- NOT NULL при scope='category', NULL при 'total'
    limit_eur    REAL NOT NULL CHECK (limit_eur > 0),          -- месячный лимит в EUR
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at   TEXT,                                          -- soft-delete (NULL = активен)
    CHECK (
        (scope = 'category' AND category_id IS NOT NULL) OR
        (scope = 'total'    AND category_id IS NULL)
    )
);

-- Один активный бюджет на категорию (NULL'ы в category_id различны → потолок не мешает):
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_category
    ON budgets(category_id)
    WHERE deleted_at IS NULL AND category_id IS NOT NULL;

-- Максимум один активный общий потолок:
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_total
    ON budgets(scope)
    WHERE deleted_at IS NULL AND scope = 'total';
