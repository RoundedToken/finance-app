-- D1 migration 0002: expenses_cache — снапшот последних N трат для Mini App.
-- В отличие от expenses_outbox (транзитный буфер), это полный кеш для отображения.
-- MacBook раз в N синков делает full replace через /v1/admin/expenses-cache.

CREATE TABLE IF NOT EXISTS expenses_cache (
    id           TEXT PRIMARY KEY,
    date         TEXT NOT NULL,
    account_id   TEXT,
    amount       REAL NOT NULL,
    currency     TEXT NOT NULL,
    category_id  TEXT,
    note         TEXT,
    source       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    cached_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cache_date ON expenses_cache(date DESC, created_at DESC);
