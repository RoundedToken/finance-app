---
spec: SPEC-046
title: Волна 2 аудита (кластер 6) — тестовый пояс
status: done
created: 2026-07-07
owner: Stepan
---

# SPEC-046 · Волна 2 аудита — тестовый пояс (кластер 6)

## 1. Context & Problem

Продолжение аудита 2026-07 (отчёт `docs/audits/2026-07-full-audit/06-tests-qa.md`).
Денежное ядро worker покрыто образцово, но пояс вокруг — без автотестов:
клиентская математика Mini App Stats, миграции vs schema.sql, мутирующий
периметр Mini App, фиатная ветка rates, CRUD incomes/categories/snapshots,
парсер бота, prod-smoke. QA-01 уже закрыт SPEC-042.

| ID | P | Суть |
|---|---|---|
| QA-02 | P1 | Денежная аналитика Mini App «Статистика» — ноль автотестов на клиентскую математику |
| QA-03 | P1 | Миграции vs schema.sql: suite гоняется против схемы, которой нет на проде |
| QA-04 | P2 | Мутирующие HTTP-handlers и периметр Mini App не покрыты e2e |
| QA-06 | P2 | Фиатная ветка rates.ts (saveRates) без тестов |
| QA-07 | P2 | incomes/categories/snapshots-CRUD без тестов |
| QA-08 | P2 | bot.ts: парсер текстового ввода трат не тестируется |
| QA-10 | P2 | Нет автоматического prod-smoke после деплоя |

## 2. Design

- **QA-02**: математика Stats уже жила в `cloud/miniapp/src/lib/stats.ts`
  (SPEC-036) — довынесены остатки из `StatsScreen.tsx` (`prevPeriod`,
  drill-down: `drillItems`/`drillSumEur`), поведение 1:1. В miniapp добавлен
  vitest (`npm test`) + golden-тесты `src/lib/stats.test.ts` (30 шт): агрегация
  month/year/all, границы периодов (первый/последний день месяца), missing-rate
  (`amount_eur=null` считается в missing, не теряется молча), drill-down,
  палитра, тренд, пустой набор.
- **QA-03**: `test/migrations-parity.test.ts` — БД №1 из `schema.sql`, БД №2 из
  baseline + `migrations/*.sql` (0001…0019) на node:sqlite. Baseline —
  справочники accounts/categories/currencies/authorized_users в до-миграционной
  форме (прод-DDL минус ALTER-колонки 0006/0014; метод — аудит
  08-data-integrity § Блок A). Сравнение нормализованного sqlite_master:
  множества таблиц/колонок (тип/NOT NULL/DEFAULT/PK) + индексы; allowlist —
  порядок колонок после ALTER (множества, не последовательности).
- **QA-04**: `makeInitData` вынесен из spec-045-теста в `test/helpers.ts`;
  `test/spec-046-miniapp-perimeter.test.ts` — e2e через `worker.fetch`:
  POST/PUT/DELETE `/v1/expenses` с валидным самоподписанным initData +
  whitelisted user → 200 (сид authorized_users), битый hash → 401,
  не-whitelisted → 403, Zod (`amount: -5`) → 400 с zodMessage.
- **QA-06**: `test/rates.test.ts` дополнен `saveRates` на D1-моке:
  INSERT OR REPLACE (обновление того же дня без дублей), история других дат
  цела, пропуск не-finite/неположительных, source-override.
  `fetchLatestRatesEUR` сетевой — не гоняется (parseLatestCsv покрыт SPEC-043).
- **QA-07**: `test/incomes.test.ts` (деривация валюты из ведра, ложный
  goal_id → 400, FIN-01 guard смены счёта, soft-delete, amount_eur date-aware),
  `test/categories.test.ts` (create/rename/деактивация is_active=0 — история
  трат цела), `test/snapshots-crud.test.ts` (create идемпотентен по id,
  unknown account → 400, update/soft-delete + сверка effective_balance).
  Паттерн — `test/transactions.test.ts`.
- **QA-08**: `parseExpense` в `bot.ts` — уже чистая функция без side-effects,
  добавлен export (поведение 1:1); `test/bot-parse.test.ts`: канонический
  формат, lowercase-валюта, запятая-разделитель, отрицательная сумма → null,
  свободный текст → null, валюта 6+ букв → null.
- **QA-10**: `local/scripts/prod_smoke.py` — read-only смоук прода: healthz 200,
  `/v1/bootstrap` и `/v1/web/me` и `/v1/rates` без auth → 401, `/tg` POST без
  секрета → 403, удалённый `/v1/admin/references` → 404; опционально свежесть
  курсов через `wrangler d1` (max(rates.date) ≥ today−3d). URL из
  `cloud/miniapp/.env`, секретов в выводе нет, кастомный UA (CF-бот-защита
  режет Python-urllib в 403). Задокументирован в `local/README.md`.

## 3. Non-goals

- **QA-05** (contract-слой worker↔клиенты) — отложен: [известно] в roadmap
  (SPEC-006 N3 / Batch E), требует zod-схем ответов — отдельный заход.
- **QA-09** (value-asserts в Playwright-харнесах, iOS-прогон) — отложен:
  требует iOS-сессии и правок харнесов — отдельный заход.
- **QA-11…15 (P3)** — волна 3 (CI gitleaks/build/lint, typecheck тестов,
  coverage, ORDER BY-ревью, legacy test_ui.py).

## 4. Acceptance criteria

- [x] AC1: `cloud/miniapp` — vitest подключён (`npm test`), 30 golden-тестов
  stats зелёные; StatsScreen импортирует всю математику из `lib/stats.ts`;
  `tsc --noEmit` чист; `npm run build` зелёный.
- [x] AC2: migrations-parity: schema.sql ≡ baseline+0001…0019 (таблицы, колонки
  с NOT NULL/DEFAULT/PK, индексы); mutation-sanity проверен (DROP INDEX ловится).
- [x] AC3: e2e-периметр Mini App: 200/401/403/400(zodMessage) на
  POST/PUT/DELETE `/v1/expenses`; makeInitData переиспользуется из helpers.ts.
- [x] AC4: saveRates — REPLACE того же дня, skip мусорных значений (тесты).
- [x] AC5: CRUD incomes/categories/snapshots покрыт (22 теста), включая
  [известно]-пункты roadmap: guard смены валюты incomes (SPEC-006 OQ1).
- [x] AC6: parseExpense экспортирован (1:1), 11 тестов парсера зелёные.
- [x] AC7: `prod_smoke.py` прогнан на проде — SMOKE: GREEN (7/7 чеков).
- [x] AC8: `cd cloud/worker && npm test` — все зелёные (256 → 307);
  `cd cloud/miniapp && npm test` зелёные (0 → 30); tsc чист worker+miniapp.

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в сессии аудита (волна 2,
  кластер 6), ветка `fix/audit-wave2-cluster6-tests`. QA-05/QA-09 отложены
  (Non-goals), P3 — волна 3.
- 2026-07-07: `done` — PR #34 (`eb8b7d8`), worker+miniapp задеплоены, prod_smoke GREEN. Визуальная проверка Stats-рефактора: агрегация идентична (скрин «Всё»). Известный хвост: шаг харнеса «месяц с данными» устарел (мок в мае, шаг −1 от текущего месяца) — класс QA-09, волна 3.
