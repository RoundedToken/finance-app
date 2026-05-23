-- D1 migration 0001: device heartbeats для visibility состояния sync.
-- MacBook при каждом sync пишет сюда статус, bot читает для команды /sync.

CREATE TABLE IF NOT EXISTS device_heartbeats (
    device_id              TEXT PRIMARY KEY,        -- 'macbook' (один пока)
    last_seen              TEXT NOT NULL,           -- любой touch к Worker
    last_sync_attempt_at   TEXT,                    -- момент последнего sync (успех или ошибка)
    last_sync_success_at   TEXT,                    -- момент последнего успешного sync
    last_pulled            INTEGER NOT NULL DEFAULT 0,
    last_inserted          INTEGER NOT NULL DEFAULT 0,
    last_confirmed         INTEGER NOT NULL DEFAULT 0,
    last_error             TEXT,
    notes                  TEXT
);
