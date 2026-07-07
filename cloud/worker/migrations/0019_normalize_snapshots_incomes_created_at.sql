-- 0019: нормализация created_at в snapshots/incomes к канону 'YYYY-MM-DD HH:MM:SS'
-- (DB-09 / SPC-09 / FIN-04, аудит 2026-07, волна 2 кластер 7).
--
-- Миграция 0013 нормализовала только expenses; импорт-батчи 2026-05-25 оставили
-- 198 снапшотов и 22 дохода в ISO-T-формате ('2026-05-25T23:59:59Z'). Tie-break
-- баланса (SPEC-024) сравнивает created_at строково МЕЖДУ таблицами — два формата
-- это латентная ловушка для любого нового кода.
--
-- Момент времени не меняется (UTC→UTC), только формат: 'T'→' ', отрезаем 'Z'/мс.
-- Порядок SPEC-031 (импорт-снапшоты 23:59:59 «старше» импорт-событий дня) сохраняется:
-- проверено пересчётом effective_balance всех вёдер на 36 месячных срезов
-- до/после на копии прода 2026-07-07 — 0 расхождений.

UPDATE snapshots
   SET created_at = substr(replace(replace(created_at, 'T', ' '), 'Z', ''), 1, 19)
 WHERE created_at LIKE '%T%';

UPDATE incomes
   SET created_at = substr(replace(replace(created_at, 'T', ' '), 'Z', ''), 1, 19)
 WHERE created_at LIKE '%T%';

-- updated_at тем же каноном (не участвует в tie-break, но зоопарк форматов ни к чему).
UPDATE snapshots
   SET updated_at = substr(replace(replace(updated_at, 'T', ' '), 'Z', ''), 1, 19)
 WHERE updated_at LIKE '%T%';

UPDATE incomes
   SET updated_at = substr(replace(replace(updated_at, 'T', ' '), 'Z', ''), 1, 19)
 WHERE updated_at LIKE '%T%';
