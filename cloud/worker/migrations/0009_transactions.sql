-- 0009_transactions.sql — Stage 7.5: Транзакции / обмены / цепочки (SPEC-008)
--
-- Добавляет:
--   - transactions: exchange (между валютами) + transfer (между вёдрами
--     одной валюты). Опциональный chain_id для multi-step операций.
--   - snapshots.transaction_id: nullable FK для каскадного soft-delete
--     auto-сгенерированных snapshot'ов при удалении transaction.

CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL CHECK (type IN ('exchange','transfer')),
    date             TEXT NOT NULL,                              -- YYYY-MM-DD
    from_account_id  TEXT NOT NULL REFERENCES accounts(id),
    to_account_id    TEXT NOT NULL REFERENCES accounts(id),
    from_amount      REAL NOT NULL CHECK (from_amount > 0),
    from_currency    TEXT NOT NULL REFERENCES currencies(code),
    to_amount        REAL NOT NULL CHECK (to_amount > 0),
    to_currency      TEXT NOT NULL REFERENCES currencies(code),
    fee_amount       REAL CHECK (fee_amount IS NULL OR fee_amount >= 0),
    fee_currency     TEXT REFERENCES currencies(code),
    note             TEXT,
    chain_id         TEXT,
    chain_sequence   INTEGER,
    goal_id          TEXT REFERENCES goals(id),                  -- зарезервировано Stage 8
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_chain   ON transactions(chain_id, chain_sequence);
CREATE INDEX IF NOT EXISTS idx_transactions_from    ON transactions(from_account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_to      ON transactions(to_account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_active  ON transactions(date) WHERE deleted_at IS NULL;

ALTER TABLE snapshots ADD COLUMN transaction_id TEXT REFERENCES transactions(id);
CREATE INDEX IF NOT EXISTS idx_snapshots_transaction ON snapshots(transaction_id);
