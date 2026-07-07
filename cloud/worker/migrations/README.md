# Миграции D1 (`finances-outbox`)

**⚠ Цепочка начинается НЕ с нуля.** Справочники `accounts`, `categories`,
`currencies` и `authorized_users` были созданы **до** миграции 0001, вне цепочки
(ранняя эпоха scaffold'а), а сиды справочников (32 категории, валюты, whitelist)
живут только в данных прода и его дампах. Поэтому:

- **Реплей `0001…NNNN` на голой базе невозможен** без ручного bootstrap'а этих
  четырёх таблиц (их до-миграционная форма зафиксирована в
  `test/migrations-parity.test.ts` § BASELINE_SQL).
- **Bootstrap новой базы — ТОЛЬКО импортом дампа** (см. `local/README.md`
  § Restore-runbook). `schema.sql` — документация текущей структуры + основа
  тест-моков, не инструмент восстановления.

Правила (CLAUDE.md § 2):

1. Применённые миграции **immutable** — любые изменения только новым файлом.
2. Применять **штатно**: `wrangler d1 migrations apply finances-outbox --remote`
   (трекинг `d1_migrations` вылечен 2026-07-07, аудит DB-04; workaround
   `execute --file` больше не использовать).
3. Перед миграцией, трогающей данные, — backup (`python local/scripts/backup_d1.py`).
4. `schema.sql` синхронизируется тем же PR; эквивалентность цепочки и снапшота
   гардит `test/migrations-parity.test.ts` (QA-03).

Реестр миграций с аннотациями — `docs/data-model.md` § Миграции.
