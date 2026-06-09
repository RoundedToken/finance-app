-- 0016_rate_ticks.sql — SPEC-028: внутридневная история курса (свежесть «по времени фетча»)
--
-- Дневная rates НЕ меняется (нулевой риск регрессии канонического слоя конвертации, ADR-014):
-- крипто-фетч продолжает писать в rates дневной курс (закрытие дня) для historical-серий, и
-- ДОПОЛНИТЕЛЬНО пишет тик сюда. mark-to-market «сейчас» берёт самый свежий тик (MAX(fetched_at)),
-- а не курс на календарную дату. Фиат тики не пишет (NG1 — обновляется ~раз в день).
--
-- Применение: backup → wrangler d1 execute finances-outbox --remote --file этот_файл
-- (НЕ migrations apply — см. memory d1-migrations-apply-via-execute-file). Идемпотентно.

CREATE TABLE IF NOT EXISTS rate_ticks (
    base       TEXT NOT NULL,                 -- 'EUR' (фиксированная база)
    quote      TEXT NOT NULL,                 -- 'ETH' (крипта)
    rate       REAL NOT NULL,                 -- 1 base = rate × quote (инверсия 1/price, как в rates)
    source     TEXT NOT NULL,                 -- провайдер: 'binance' | 'coinbase' | 'coingecko'
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),  -- момент фетча (UTC) — авторитет свежести
    PRIMARY KEY (base, quote, fetched_at)
);
CREATE INDEX IF NOT EXISTS idx_rate_ticks_quote_fetched ON rate_ticks(quote, fetched_at DESC);
