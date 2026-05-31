---
id: SPEC-022
title: D1-mock тесты на getEffectiveBalance + getDashboard
status: done
owner: stepan
created: 2026-05-31
updated: 2026-05-31
links:
  - adr: docs/decisions.md#adr-011
  - parent: SPEC-011   # денежная математика, которую покрываем
  - depends_on: [SPEC-011, SPEC-013, SPEC-016, SPEC-021]
---

# D1-mock тесты на getEffectiveBalance + getDashboard

> Пост-MVP Фаза 2, тех-долг **2.6** (`docs/post-mvp-roadmap.md`). Тесты-only — продакшн-код не меняется. Лёгкий tier (нет миграций/endpoint'ов/денежной математики).

## 1. Context & Problem

Money-critical wiring не покрыт тестами: зелёные только чистые `reconstructBalance`/`RatesIndex` (ledger/rates), а **`getEffectiveBalance`** (snapshots.ts — баланс ведра из D1) и **`getDashboard`** (dashboard.ts — где net worth / runway / series получают итог) ходят в D1 и тестами не закрыты. Регрессия в SQL (фильтр `date>baseline`, fee-JOIN, оконные суммы, date-aware конверсия) или в форме ответа пройдёт молча. В частности SPEC-021 оставил **AC1-гард** (`net_worth_series[].by_bucket_native` присутствует и == `effective_balance` ведра на сегодня) без авто-теста — убери поле, и спарклайны на `/accounts` молча исчезнут.

## 2. Goals

- **G1**: In-memory мок `env.DB` на **`node:sqlite`** (`DatabaseSync`, встроен в Node 24 — без новых зависимостей), реализующий используемый воркером срез D1: `prepare().bind(...).all<T>()/.first<T>()/.run()` + `batch()`. Грузит реальную `schema.sql` → гоняем **настоящий SQL** воркера (D1 = SQLite). Переиспользуемая инфра для будущих тестов (goals/budgets/transactions).
- **G2**: Тесты `getEffectiveBalance` / `effectiveBalancePerAccount`: baseline-выбор, окно событий (`> baseline.date && <= asOf`), все 5 типов событий (income/expense/tx-in/tx-out/goal_contribution) + fee-атрибуция (JOIN), исключение external/deleted.
- **G3**: Тесты `getDashboard`: **AC1-гард SPEC-021** (`by_bucket_native` присутствует во всех точках + == `getEffectiveBalance(today)` по каждому ведру); консистентность `net_worth_eur` = Σ EUR-балансов; помесячный ряд отражает события по месяцам; targeted/free split по активной цели; `by_bucket` (EUR) ≈ конверсия `by_bucket_native`.
- **G4**: Детерминизм — «сегодня» зафиксирован (`vi.setSystemTime`), сиды с фиксированными датами.

## 3. Non-Goals

- **NG1**: НЕ переходим на `@cloudflare/vitest-pool-workers`/Miniflare (бо́льшая инфра-перестройка; `node:sqlite` даёт ту же SQLite-точность для чистых D1-функций).
- **NG2**: НЕ покрываем HTTP-слой/auth/роутинг (`index.ts` handlers) — только доменные функции, считающие деньги.
- **NG3**: Не меняем продакшн-код. Если тест вскроет баг — отдельный `fix`-commit (Phase 4), не молча правим под тест.
- **NG4**: Не строим полный D1-API (Sessions, dump, withSession) — только используемый воркером срез.

## 5. Data model

Без изменений D1. Мок грузит существующую `cloud/worker/schema.sql` в `:memory:` SQLite. FK не форсируем (как D1 по умолчанию) → свобода порядка сидов.

## 9. Acceptance criteria

- [x] AC1: `test/d1-mock.ts` — `MockD1` на `node:sqlite`, грузит `schema.sql`; `prepare/bind/all/first/run/batch` совместимы по форме с D1; `seed()`-хелпер с дефолтами NOT NULL-колонок. FK off (паритет с D1).
- [x] AC2: `getEffectiveBalance` — 8 кейсов (нет baseline; baseline+события; событие в день baseline исключено; asOf-cutoff; последний baseline ≤ asOf; 5 типов событий; fee-JOIN; soft-delete). Значения сверены вручную.
- [x] AC3: `effectiveBalancePerAccount(today)` — мапа по всем active-вёдрам, исключает `form='external'` и `deleted_at`.
- [x] AC4: `getDashboard` — `by_bucket_native` есть в каждой точке `net_worth_series` и для текущего месяца == `getEffectiveBalance(env, id, today).balance` по каждому ведру (гард SPEC-021 AC1).
- [x] AC5: `getDashboard` — `net_worth_eur` == Σ EUR-балансов; targeted/free split по активной цели; помесячный ряд меняется с событиями; `by_bucket`≈конверсия `by_bucket_native`.
- [x] AC6: 65 тестов зелёные (`vitest run`), детерминированы; `tsc` src зелёный (test/ вне `include`).
- [x] AC7: Mutation-sanity: off-by-one в `by_bucket_native` (роняет 2 dashboard-теста) + инверсия знака расхода в `getEffectiveBalance` (роняет 4 теста, в т.ч. cross-check гард) — тесты не тавтологичны.

## 10. Test plan

- `npx vitest run` в `cloud/worker` — новые `test/effective-balance.test.ts` + `test/dashboard.test.ts` поверх `test/d1-mock.ts`, плюс существующие 51 (ledger/rates/budgets/schemas) зелёные.
- Mutation-sanity вручную: временно сломать знак события / убрать `by_bucket_native` → красный тест → revert.
- CI (Фаза 1.4) подхватит автоматически (typecheck + vitest на push).

## 11. Risks & open questions

- **R1** (закрыт): `node:sqlite` (`DatabaseSync`) появился в Node 22.5 и стабилен в 24; в Node 20 — отсутствует (`ERR_UNKNOWN_BUILTIN_MODULE`). CI пинил Node 20 → `npm test` упал бы на каждом push (нашёл solution-architect, must-fix). **Фикс:** `.github/workflows/ci.yml` все джобы → Node 24 (совпадает с локалью); `cloud/worker/package.json` `engines.node = ">=22.5"` как явный контракт.
- **R2**: Мок реализует только используемый срез D1 — при появлении новых форм вызова (напр. `.first("col")`, `raw()`) расширить адаптер.

## 13. Changelog spec'а

- 2026-05-31: создан; лёгкий tier (тесты-only), сразу `in_progress`. Закрывает тех-долг 2.6 + отложенный AC1-гард SPEC-021.
- 2026-05-31: Phase 3 (workflow: solution-architect + адверсариальный coverage-аудитор) — оба **CHANGES_REQUESTED**, 2 must-fix. **(1)** CI на Node 20 → `node:sqlite` отсутствует → CI красный (R1, починено). **(2)** Адверсарий доказал мутацией: гард AC1 (`by_bucket_native`==`getEffectiveBalance`) был тавтологичен к common-mode (одинаковый `<=`→`<` в обе реализации проходил), а same-day exclusion в dashboard-пути (`ledger > baselineDate`) не покрыт. **Фикс:** +8 граничных тестов (73 всего) — снапшот на `date==asOf`/`==today`, same-day в dashboard-пути, today-cap (M3), legacy-goal targeted (M6), fee в третьей валюте, deleted-tx, created_at tie-break, is_active=0 ведро. Перепроверено мутациями: common-mode граница + M3/M4/M6 теперь ловятся. Продакшн-код не тронут (`git diff src/` пуст). status → `done`.
