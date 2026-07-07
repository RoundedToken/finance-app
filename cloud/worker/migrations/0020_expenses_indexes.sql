-- 0020 · Индексы expenses под реальные запросы (аудит 2026-07: DB-08 / WRK-12).
--
-- (а) getEffectiveBalance (snapshots.ts) на каждый пересчёт ведра гоняет
--     `WHERE account_id = ? AND deleted_at IS NULL AND date <= ?` по expenses —
--     самой большой таблице — full scan'ом (для incomes/snapshots/transactions
--     составные индексы есть). Partial-индекс (account_id, date) закрывает
--     горячий путь /v1/web/accounts и dashboard.
-- (б) Мёртвые индексы sync-эпохи (до ADR-011): updated_at не фильтруется нигде,
--     user_id участвует только в PK-lookup'ах (`WHERE id = ? AND user_id = ?`),
--     idx_expenses_deleted — низкоселективный. Только тормозят INSERT/UPDATE.
--
-- goal_contributions(account_id) НЕ индексируем: таблица пустая (DB-08 —
-- некритично), добавим при появлении данных.
--
-- ⚠ Применять штатно: `wrangler d1 migrations apply finances-outbox --remote`
--   (после бэкапа — CLAUDE.md правило 7). schema.sql синхронизирован этим же PR.

CREATE INDEX IF NOT EXISTS idx_expenses_account_date
    ON expenses(account_id, date) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_expenses_updated;
DROP INDEX IF EXISTS idx_expenses_user_date;
DROP INDEX IF EXISTS idx_expenses_deleted;
