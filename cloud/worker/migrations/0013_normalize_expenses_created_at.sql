-- 0013_normalize_expenses_created_at.sql (SPEC-024)
-- Канонизируем формат created_at/updated_at в expenses под 'YYYY-MM-DD HH:MM:SS'
-- (как datetime('now') в остальных таблицах). Старые строки писались клиентом
-- (db.ts:createExpense + Mini App) как ISO '2026-06-01T09:00:00.123Z' — это ломает
-- межтабличное строковое сравнение created_at (tie-break границы снапшота), т.к.
-- ' ' (0x20) < 'T' (0x54): любой ISO-расход «новее» любого снапшота того же дня.
--
-- Чистый реформат строки: substr(...,1,19) отрезает миллисекунды и 'Z', replace
-- меняет разделитель 'T'→' '. Момент времени НЕ меняется (UTC→UTC). Денежные суммы
-- НЕ трогаются. Идемпотентно: строки уже в каноне (без 'T') фильтр WHERE пропускает.
--
-- ⚠️ DEPLOY-ORDER: применять ДО (или вместе с) деплоем нового Worker. Новая граница
-- баланса сравнивает expenses.created_at со снапшотом строкой; до канонизации ISO-расход
-- ('...T..Z') лексически «больше» снапшота (' '<'T') → транзиентно неверный баланс
-- same-day expense-vs-snapshot. Обратный порядок (миграция раньше кода) безопасен:
-- старый Worker created_at в балансе не использовал. Перед прогоном — backup D1 (правило 7).
UPDATE expenses
   SET created_at = replace(substr(created_at, 1, 19), 'T', ' ')
 WHERE created_at LIKE '%T%';

UPDATE expenses
   SET updated_at = replace(substr(updated_at, 1, 19), 'T', ' ')
 WHERE updated_at LIKE '%T%';
