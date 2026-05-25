-- 0010_drop_auto_snapshots.sql — Stage 7.5.4 (SPEC-011)
--
-- Полное удаление auto-сгенерированных snapshots. С этого момента
-- balance bucket'а computed on-demand как (last manual snapshot +
-- Σ events). Auto-rows перестают записываться Worker'ом (см.
-- transactions.ts — генерация снята).
--
-- Колонка `snapshots.transaction_id` остаётся — потенциально полезна
-- если когда-то захочется удалить tx-cascade через FK lookup. Сейчас
-- всегда NULL для новых строк.

DELETE FROM snapshots WHERE source = 'auto_transaction';
