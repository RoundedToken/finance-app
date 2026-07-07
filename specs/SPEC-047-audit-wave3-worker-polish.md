---
spec: SPEC-047
title: Волна 3 аудита — P3-полировка worker-зоны
status: in_progress
created: 2026-07-07
owner: Stepan
---

# SPEC-047 · Волна 3 аудита — P3-полировка worker (WRK/FIN/SEC/DB/QA)

## 1. Context & Problem

Продолжение аудита 2026-07 (мастер § Волна 3): все P3-хвосты worker-зоны из
отчётов 02 (WRK), 03 (FIN), 07 (SEC-11…15), 08 (DB-07…13), 06 (QA-11…14).
Для каждой находки принято решение FIX / WONTFIX / DEFER (одной строкой в
отчёте аудита); здесь — только FIX-набор.

| ID | Суть фикса |
|---|---|
| SEC-11 | Google `id_token`: проверка `iss` + `exp` (defense-in-depth поверх TLS code-exchange) |
| SEC-12 | CORS: deny (без ACAO) для не-allowlist browser-origin вместо `*`; `X-Content-Type-Options: nosniff` в JSON-ответах |
| SEC-13 (частично) | `.max()` на строковые Zod-поля (id/name/note/…) — анти-раздувание; CF Rate Limiting Rules → DEFER (дашборд-операция) |
| SEC-14 (хвост) | HSTS в `_headers` Admin + Mini App (остальное закрыто волной 2) |
| SEC-15 (хвост) | npm-обновления dev-chain: vitest 2→3, wrangler 3→4 (worker), vite 5→7 (admin/miniapp) |
| FIN-05 | `RatesIndex.rateAt`: тик не подменяет историю при отсутствии дневных курсов quote |
| FIN-06 | `net_worth_series`: r2 однократно на выдаче, не в аккумуляции by_form/by_currency |
| FIN-08 | `budgetStatus` от `r2(spent)` — display и статус согласованы на границе |
| FIN-10 | SPEC-030: пример прогноза стейкинга приведён к compound-формуле кода |
| FIN-11 | Legacy-цель без `target_currency`: detail-ветка выровнена на EUR (как listGoals) |
| FIN-12 | Equality-тест `free`-формулы dashboard ↔ /v1/web/accounts на одном моке |
| FIN-15 | WAC: комиссия в валюте актива уменьшает `netBoughtQty` (нетто-принятое) |
| FIN-18 | `getEffectiveBalance`: fee-события входят в `events_count` |
| WRK-10 | Cron: крипта пишется той же датой, что фиат (`payload.date` в scheduled) |
| WRK-11 | Дрейф wrangler.example.toml (crons 4×/сутки, ADR-019); заголовок schema.sql — DB-02/волна 2 |
| WRK-12 = DB-08 | Миграция 0020: `idx_expenses_account_date` (partial) + DROP 3 мёртвых индексов; schema.sql синхронизирован |
| WRK-18 | `updateIncome`: неизменённая (в т.ч. деактивированная) категория не отклоняется |
| WRK-20 | Единая HTTP-семантика: no-op update/delete → 404 (все домены, вкл. Mini App expenses) |
| WRK-21 | Бот: категория резолвится по id/имени из справочника; неизвестная → подсказка со списком |
| WRK-22 | Bootstrap: один скан expenses (rows шарятся в `getEnvelopesForBootstrap`) |
| DB-07 | `migrations/README.md`: цепочка не самодостаточна, bootstrap — только дамп |
| DB-10 | Таблица-политика soft-delete в `docs/data-model.md` |
| DB-12 | Пункт техдолга roadmap переформулирован (FK-пробел — expenses, не snapshots) |
| DB-13 | Дрейф docs: домен `source`, число миграций, `source_record_id` = резерв |
| QA-11 | CI: gitleaks-job + `vite build` фронтендов вместо голого tsc |
| QA-12 | `test/` включён в typecheck (`@types/node`, каст-хвосты починены) |
| QA-14 | Ревью multi-row `.all()` без ORDER BY (bootstrap accounts/currencies), комментарий в d1-mock |

WONTFIX/DEFER (обоснования — отметки в `docs/audits/2026-07-full-audit/*`, gitignored):
QA-13 (coverage — метрика ради метрики для single-dev), SEC-13-rate-limit (дашборд-операция),
FIN-07/13/14/16 (Mini App/Admin-зоны, [известно] в roadmap / нужна продуктовая формулировка),
FIN-09 (кросс-зонная проброска `?today=` клиентами), WRK-16 (UUID в Admin-мутациях — Admin-зона),
WRK-08/22-остаток (батч-агрегатор — M, смежный техдолг), DB-11 (нужны глаза владельца на прод-данные).

## 2. Design

- **SEC-12** — `pickAllowedOrigin`: нет Origin → без CORS-заголовка ACAO; origin в
  `ADMIN_ALLOWED_ORIGINS` → echo; иначе deny (без ACAO). ⚠ Деплой-предусловие:
  в прод-var `ADMIN_ALLOWED_ORIGINS` должен быть добавлен origin Mini App Pages,
  иначе fetch Mini App перестанет проходить CORS (см. wrangler.example.toml).
- **WRK-20** — маппинг в обёртках index.ts: `{updated:false}`/`{deleted:false}` → 404
  `{error:"not found"}`; доменные ошибки "* not found" (goals/transactions) → 404.
- **WRK-21** — `resolveCategoryToken` (чистая, тестируемая): match по `id` или `name`
  (case-insensitive) среди активных расходных категорий; не нашли → ответ с перечнем
  валидных id, трата не создаётся.
- **DB-08** — миграция 0020 НЕ применена на прод из этой ветки (применяет
  оркестратор при деплое, после бэкапа — правило 7).

## 3. Non-goals

- Батч-вариант `effectiveBalancePerAccount` (WRK-08, P2/M) — отдельный заход.
- Контрактные zod-типы worker↔клиенты (QA-05) и value-asserts харнесов (QA-09) — deferred волной 2.
- Cloudflare Rate Limiting Rules (SEC-13) — операция в дашборде CF, не в коде.

## 4. Acceptance criteria

- [x] AC1: id_token с чужим `iss` / истёкшим `exp` → 401; валидный → 302 с токеном (тест, стаб token-эндпоинта).
- [x] AC2: CORS: allowlisted origin → echo; неизвестный → ответ БЕЗ `Access-Control-Allow-Origin`; JSON-ответы несут `nosniff` (тест).
- [x] AC3: Zod: строка сверх cap (note 2000/name 200/id 128) → 400 (тест).
- [x] AC4: PUT/DELETE несуществующего id (expenses/snapshots/incomes/goals/contributions/transactions/budgets/categories) → 404; успешные пути не регрессировали (тесты).
- [x] AC5: бот: `50 EUR <имя категории>` создаёт трату с резолвнутым category_id; неизвестный токен → подсказка, записи нет (тест со стабом Telegram API).
- [x] AC6: `rateAt` с тиком без daily-курсов → null для исторической даты, тик только для «сейчас» при наличии daily (тест).
- [x] AC7: Σ by_form == Σ by_currency == total_eur в каждой точке net_worth_series с точностью r2 (тест на дробных остатках).
- [x] AC8: fee-in-asset: `staking_income_qty` не занижается на комиссию (тест); fee-событие входит в `events_count` (тест).
- [x] AC9: free-формула: kpi дашборда == summary /v1/web/accounts на одном моке (equality-тест).
- [x] AC10: updateIncome с неизменённой деактивированной категорией → ok; смена НА деактивированную → 400 (тест).
- [x] AC11: миграция 0020 ≡ schema.sql (migrations-parity зелёный); `tsc --noEmit` чист ВКЛЮЧАЯ test/; vitest зелёный на vitest 3.
- [x] AC12: CI: gitleaks-job; admin/miniapp джобы гоняют `npm run build` (tsc внутри).

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в сессии волны 3 (ветка fix/audit-wave3-worker, worktree).
- 2026-07-07: реализация завершена: worker 332/332 (vitest 3, +26 новых в `spec-047-worker-polish.test.ts` и правка FIN-05-кейса в rates.test.ts), miniapp 30/30, `tsc --noEmit` чист ×3 (worker — ВКЛЮЧАЯ test/), `npm audit` = 0 во всех трёх пакетах (vitest 2→3, wrangler 3→4, vite 5→7, plugin-react 4→5, @types/node добавлен). Миграция 0020 НЕ применена на прод (применить при деплое после бэкапа). ⚠ Деплой-предусловия: (1) прод-var `ADMIN_ALLOWED_ORIGINS` дополнить origin'ом Mini App Pages ДО деплоя worker'а (SEC-12), (2) `wrangler d1 migrations apply` для 0020, (3) wrangler 4 — первый деплой проверить `--dry-run`.
