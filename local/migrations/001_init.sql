-- Migration 001: initial schema
-- Соответствует local/schema.sql на момент создания.
-- НЕ редактировать — добавлять новые миграции вместо изменения этой.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE _migrations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE owners (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    is_self     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE currencies (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT,
    is_crypto   INTEGER NOT NULL DEFAULT 0,
    decimals    INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN (
                    'cash','bank_current','bank_deposit',
                    'exchange','exchange_earn','crypto_wallet',
                    'brokerage','external')),
    currency    TEXT NOT NULL REFERENCES currencies(code),
    owner_id    TEXT NOT NULL REFERENCES owners(id),
    group_name  TEXT,
    yield_pct   REAL NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    color       TEXT,
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_owner ON accounts(owner_id);
CREATE INDEX idx_accounts_active ON accounts(is_active);

CREATE TABLE categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('expense','income','system')),
    parent_id   TEXT REFERENCES categories(id),
    emoji       TEXT,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_type ON categories(type);

CREATE TABLE transactions (
    id           TEXT PRIMARY KEY,
    date         TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN (
                     'exchange','transfer','interest','income','adjustment')),
    from_account TEXT REFERENCES accounts(id),
    to_account   TEXT REFERENCES accounts(id),
    amount_out   REAL,
    ccy_out      TEXT REFERENCES currencies(code),
    amount_in    REAL,
    ccy_in       TEXT REFERENCES currencies(code),
    rate         REAL,
    fee          REAL,
    fee_ccy      TEXT REFERENCES currencies(code),
    chain_id     TEXT,
    category_id  TEXT REFERENCES categories(id),
    note         TEXT,
    source       TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','telegram','csv_import','estimated')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_chain ON transactions(chain_id);
CREATE INDEX idx_transactions_from ON transactions(from_account);
CREATE INDEX idx_transactions_to ON transactions(to_account);
CREATE INDEX idx_transactions_type ON transactions(type);

CREATE TABLE expenses (
    id                TEXT PRIMARY KEY,
    date              TEXT NOT NULL,
    account_id        TEXT REFERENCES accounts(id),
    amount            REAL NOT NULL,
    currency          TEXT NOT NULL REFERENCES currencies(code),
    category_id       TEXT REFERENCES categories(id),
    note              TEXT,
    source            TEXT NOT NULL
                          CHECK (source IN (
                              'telegram','csv_ok_import','manual',
                              'estimated_from_snapshot')),
    source_record_id  TEXT,
    created_at        TEXT NOT NULL,
    synced_at         TEXT,
    deleted_at        TEXT
);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_account ON expenses(account_id);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_synced ON expenses(synced_at);
CREATE INDEX idx_expenses_deleted ON expenses(deleted_at);

CREATE TABLE snapshots (
    id              TEXT PRIMARY KEY,
    date            TEXT NOT NULL,
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    native_amount   REAL NOT NULL,
    source          TEXT NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual','estimated_from_legacy')),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_snapshots_date ON snapshots(date);
CREATE INDEX idx_snapshots_account ON snapshots(account_id);

CREATE TABLE rates (
    date        TEXT NOT NULL,
    base        TEXT NOT NULL REFERENCES currencies(code),
    quote       TEXT NOT NULL REFERENCES currencies(code),
    rate        REAL NOT NULL,
    source      TEXT NOT NULL CHECK (source IN (
                    'google','cbr','frankfurter','ecb','manual','derived')),
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, base, quote)
);
CREATE INDEX idx_rates_base_quote ON rates(base, quote);

CREATE TABLE sync_state (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    pulled          INTEGER DEFAULT 0,
    inserted        INTEGER DEFAULT 0,
    confirmed       INTEGER DEFAULT 0,
    error           TEXT,
    duration_ms     INTEGER
);
CREATE INDEX idx_sync_log_started ON sync_log(started_at);

-- Seed: системные категории и валюты
INSERT INTO currencies (code, name, emoji, is_crypto, decimals) VALUES
    ('EUR',  'Euro',           '🇪🇺', 0, 2),
    ('USD',  'US Dollar',      '🇺🇸', 0, 2),
    ('RUB',  'Russian Ruble',  '🇷🇺', 0, 2),
    ('RSD',  'Serbian Dinar',  '🇷🇸', 0, 2),
    ('USDT', 'Tether',         '₮',   1, 2);

INSERT INTO owners (id, name, is_self) VALUES
    ('self', 'Me', 1);

-- "Внешний мир" — псевдо-счёт для income/expense
INSERT INTO accounts (id, name, type, currency, owner_id, group_name) VALUES
    ('external', 'External world', 'external', 'EUR', 'self', 'system');

INSERT INTO _migrations (id, name) VALUES (1, '001_init');
