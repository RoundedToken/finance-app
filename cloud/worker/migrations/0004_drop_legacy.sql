-- D1 migration 0004: убираем устаревшие таблицы.
-- После D1-centric pivot expenses — источник правды, остальное не нужно.

DROP TABLE IF EXISTS expenses_outbox;
DROP TABLE IF EXISTS expenses_cache;
DROP TABLE IF EXISTS device_heartbeats;
DROP TABLE IF EXISTS rate_limit;
