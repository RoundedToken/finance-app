# SPEC-006 — Architecture audit

**Verdict:** APPROVED_WITH_NICES
**Auditor:** claude-opus-4-7[1m] (self, fallback)
**Date:** 2026-05-25

> **Note:** независимый solution-architect subagent дважды падал с
> `529 Overloaded` от Anthropic API. Аудит выполнен сессией, которая писала
> код — независимость взгляда не достигнута. Перепроверить независимым
> агентом при стабилизации API (tech-debt).

## Summary

Реализация Stage 6 (Incomes) архитектурно консистентна с Stage 5a
(snapshots), уважает все 4 релевантных ADR (005/011/012/013) и не нарушает
ни одного spec-non-goal. Found 0 must-fix, 1 should-fix (catById helper
дублирует логику), 6 nice-to-have (большинство — карринговые retro-debt).

## Must-fix (M)

Нет.

## Should-fix (S)

- **S1.** `IncomesPage.tsx:catById(categories, id)` — локальный helper,
  дублирует паттерн `accById = useMemo(new Map(...))` из родительского
  компонента. Можно: (а) передать prop `categoriesById: Map`, либо
  (б) вытащить в `lib/utils.ts` как `findById<T>(arr, key)` generic.
  Не блокер push, но в backlog первоочередно.

## Nice-to-have (N)

- **N1.** `lookupAccountCurrency` + `categoryExists` в `createIncome` —
  два последовательных D1-round-trip перед INSERT. Можно объединить в
  один `SELECT … FROM accounts a, income_categories c WHERE a.id=? AND c.id=?`
  или CTE. Не критично для personal scale, но в backlog Stage 7.
- **N2.** Schema sync: `cloud/worker/schema.sql` синхронизируется руками
  с `migrations/0007_incomes.sql`. Карринговое наследие из retro
  (`SPEC-005` R3); план на Stage 8+ — генерить schema.sql из миграций.
- **N3.** TypeScript contract drift: `incomes.ts` определяет
  `IncomePayload`/`IncomeCategory` в worker; `admin/src/api/types.ts` —
  свои аналогичные типы `Income`/`IncomeCategory`/`IncomeCreatePayload`/`IncomeUpdatePayload`.
  Нет shared schema — рассинхрон обнаруживается только в runtime. Карринговая
  тема, общая для всего проекта.
- **N4.** `String(err)` leak в `index.ts:113` (общий catch-all) — наследие
  ARCH-001 retro audit. Не фиксили специально, потому что это не
  incomes-specific.
- **N5.** `incomes.amount REAL` — `REAL` (float) для денежных сумм
  имеет точностный риск (например, 0.1 + 0.2 ≠ 0.3). Тот же выбор у
  `expenses.amount` и `snapshots.amount`. Acceptable для personal scale
  до 6-7 знаков, но в Stage 9 (инвестиции) может проявиться. В backlog.
- **N6.** `categoryExists` проверяет `is_active = 1`, а `lookupAccountCurrency`
  проверяет `deleted_at IS NULL`. Логика deactivation чуть разная между
  доменами — это карринг (accounts/categories в Stage 5a). Можно unify в
  future Stage 7.

## SPEC conformance

### Goals (§2)
- **G1** ✅ — `incomes` + `income_categories` со всеми полями из §5.
- **G2** ✅ — `GET/POST/PUT/DELETE /v1/web/incomes` + `GET /v1/web/income-categories`,
  все за Bearer JWT.
- **G3** ✅ — IncomesPage реализует 3 KPI + breakdown + table + modal.
- **G4** ✅ — Sidebar активирован, иконка `TrendingUp`.
- **G5** ✅ — 6 категорий через миграцию 0007: salary/interest/gifts/cashback/freelance/other.
- **G6** ✅ — `INSERT OR IGNORE`; повторный POST с тем же `id` =
  `inserted=false`.

### Non-goals (§3) — реализация соблюдает их
- **NG1** ✅ — нет auto-snapshot. UI checkbox «также создать snapshot»
  отсутствует.
- **NG2** ✅ — нет recurring schedule/cron. Только client-side кнопка
  «Из последней».
- **NG3** ✅ — один bucket за раз; нет `income_allocation` таблицы.
- **NG4** ✅ — нет `transactions` миграции; incomes — отдельная таблица.
- **NG5** ✅ — нет CRUD UI для income_categories; только wrangler.
- **NG6** ✅ — нет `/v1/incomes` (без `/web/`). Mini App не получает доступ.
- **NG7** ✅ — KPI и breakdown только на `/incomes`; DashboardPage не
  трогали.
- **NG8** ✅ — нет time-series графиков.

## ADR conformance

- **ADR-005 (UUID идемпотентность):**
  - `incomes.id TEXT PRIMARY KEY`, на клиенте UUID v4 (или сервер
    `crypto.randomUUID()` если не прислан).
  - `INSERT OR IGNORE` гарантирует идемпотентность.
  - ✅

- **ADR-011 (D1-centric):**
  - Все CRUD идут через Worker → D1.
  - Никакого local mirror, никаких `expenses_outbox`-style таблиц.
  - ✅

- **ADR-012 (Web Admin via JWT, Mini App scope зафиксирован):**
  - Все 5 endpoints — под `requireAdminSession` (Bearer JWT HS256).
  - Mini App API (`/v1/expenses`, `/v1/bootstrap`, `/v1/rates`) не
    расширен incomes endpoints. Sidebar Mini App тоже не трогали.
  - `ADMIN_ALLOWED_EMAILS` allowlist проверяется в `requireAdminSession`.
  - ✅

- **ADR-013 (spec-driven workflow):**
  - SPEC-006 написан ДО кода (Phase 1).
  - Implementation Phases 2a-2d следовали spec'у.
  - Phase 3 audit (этот документ) — оба audit subagent'а упали с
    529, fallback на self-audit с явным disclaimer.
  - ✅ (с asterisk: independence audit будет пересмотрен)

## Security checklist

- **Auth wrap.** Все 5 endpoints:
  - `GET /v1/web/income-categories` — `requireAdminSession` ✅
  - `GET /v1/web/incomes` — ✅
  - `POST /v1/web/incomes` — ✅
  - `PUT /v1/web/incomes/:id` — ✅
  - `DELETE /v1/web/incomes/:id` — ✅
- **Input validation.**
  - 4 обязательных поля проверяются в POST (`date/account_id/amount/category_id`) ✅
  - `typeof amount === 'number'` + `> 0` ✅
  - FK existence: `lookupAccountCurrency` + `categoryExists` ✅
  - PUT: проверяет amount только если присутствует ✅
  - `currency_code` НЕ принимается от клиента — сервер сам подставляет
    из `accounts.currency` ✅ (важно для целостности)
- **PII в логах.** Worker логи не выводят `amount/source/note`. Общая
  catch-все ошибка через `console.error("unhandled", err)` — карринг
  retro ARCH-001, не специфичный для incomes.
- **SQL injection.** Все queries через `prepare().bind()`. Только
  `hasSource`/`hasNote` conditional fragments — `?` vs identifier name
  (`source`/`note`) — статическая строка, не от пользователя. ✅
- **CSRF / CORS.** Все ответы через shared `jsonResponse` из `cors.ts`,
  который добавляет `Access-Control-Allow-Origin` через `pickAllowedOrigin`
  с проверкой `ADMIN_ALLOWED_ORIGINS`. Echo'ит origin только если он в
  allowlist. ✅
- **Mass-assignment.** `IncomePayload` interface не имеет `id`/`created_at`/
  `deleted_at`. Worker сам генерит `id` если не прислан; `created_at`/
  `updated_at` через `datetime('now')`; `deleted_at` через DELETE handler.
  ✅

## Code quality

### Дублирование с snapshots.ts
- `listIncomes` ≈ `listSnapshots` структурно — оба: `WHERE deleted_at IS NULL`
  + optional фильтры + LIMIT. Маленькая дупликация, не критично.
- `createIncome` vs `createSnapshot` отличается: incomes имеет FK validation
  заранее (lookupAccountCurrency/categoryExists), snapshots — нет (FK
  ловится в SQL). Это улучшение: лучший error message.
- `updateIncome` использует `hasOwnProperty` pattern для conditional
  source/note SQL — улучшение vs snapshots.ts где `note` всегда `?`.
  В retro audit (SPEC-001) этот паттерн я применил для `expenses.note`,
  здесь применил и для `source`. Consistent.
- `deleteIncome` ≈ `deleteSnapshot`. ✅

### Frontend
- `IncomesPage` использует `useEffect` для re-init модала (вместо
  `useMemo`-как-side-effect, который я применил в SnapshotsPage). Это
  целевое исправление retro `ARCH-005 NTH-1`. ✅
- `latestInCat` — `useMemo` с правильными dependencies, корректный для
  pure derivation.
- `invalidateQueries({queryKey: ["incomes"]})` — единственный invalidate;
  не трогает accounts/snapshots (incomes к ним напрямую не привязан, нет
  совместимых aggregations на этом этапе). ✅

### Naming
- `IncomePayload` (worker) vs `IncomeCreatePayload`/`IncomeUpdatePayload`
  (admin) — слегка разные именования, но семантически совместимы. ОК.
- `lookupAccountCurrency` / `categoryExists` — clear naming.
- `latestInCat` — короткое, в контексте локального hooks ОК.

### TypeScript
- Worker: типы локально в `incomes.ts`, exported.
- Admin: типы в `types.ts`, импортируются в `queries.ts` и `IncomesPage.tsx`.
- Endpoint contract: admin → worker через JSON, проверка типов только
  compile-time. Runtime mismatch может случиться — карринговая тема (N3).

### React-specific
- `useEffect` re-init имеет dependency `[open, editing?.id]`. Если `accounts`
  загружается лениво и его длина меняется после монтирования, default
  `accounts[0]?.id` не пересчитается. Это известное поведение SnapshotsPage,
  acceptable: account-loading быстрее модала.
- Pluralize функция: `pluralize(n) → доход|дохода|доходов` — корректная
  ru-плюрализация. Локальная, см. N5 (вариант вытащить в lib/i18n.ts).
- A11y: `<select aria-label="Фильтр по категории">` + `<select aria-label="Фильтр по периоду">` — labels есть. Модал имеет `<Field label=...>` для всех полей. ✅

### Worker-specific
- COALESCE + conditional SQL для source/note (hasOwnProperty pattern).
  Это улучшение vs snapshots.ts где `note` всегда `?` (что обнуляет note
  на PUT без поля; в incomes мы сохраняем). Лучшая семантика. ✅
- COALESCE с `newCurrency` для `currency_code` — корректно: NULL означает
  «не меняй». Только при account_id update пересчитываем.

### D1-specific
- 4 индекса на `incomes`: full coverage filters.
- `CHECK (amount > 0)` constraint — defense in depth (Worker уже валидирует).
  SQLite не игнорирует CHECK в INSERT OR IGNORE; но Worker reject'ит amount<=0
  заранее.

### Простота
- Нет преждевременных абстракций. Нет универсальной `transactions` таблицы
  (отложено в Stage 7). Нет income_allocation таблицы (отложено NG3).
- Прямая копия паттернов snapshots — оправдано, потому что domain
  параллельный.

## Open questions

- **OQ1.** Стоит ли инвалидировать `["accounts"]` при income mutation?
  Сейчас нет, потому что incomes не влияют на `accounts.latest_snapshot`.
  Но в Stage 8 (Dashboard) может появиться aggregate "income vs expense" —
  тогда нужно будет invalidate более широко. Решаем в Stage 8.
- **OQ2.** Audit independence: оба subagent'а упали 529 трижды каждый.
  Это unprecedented для нашего pipeline. Нужно политическое решение: блокирует
  ли API overload phase 3, или fallback на self-audit acceptable. Сейчас
  выбрал второе по указанию пользователя; зарегистрировал tech-debt
  «пересмотреть SPEC-006 audits независимыми agent'ами когда API стабилен».
