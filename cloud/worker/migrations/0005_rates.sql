-- D1 migration 0005: курсы валют.
-- Источник правды — D1 (как и для expenses). Cron Trigger в Worker fetcheт
-- ежедневно через open.er-api.com.

CREATE TABLE IF NOT EXISTS rates (
    date       TEXT NOT NULL,       -- YYYY-MM-DD дата (в UTC)
    base       TEXT NOT NULL,       -- 'EUR' (фиксированная база)
    quote      TEXT NOT NULL,       -- 'USD', 'RUB', 'RSD', 'USDT', ...
    rate       REAL NOT NULL,       -- 1 base = rate quote
    source     TEXT NOT NULL,       -- 'open-er-api', 'manual', 'derived'
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, base, quote)
);
CREATE INDEX IF NOT EXISTS idx_rates_quote_date ON rates(quote, date DESC);
