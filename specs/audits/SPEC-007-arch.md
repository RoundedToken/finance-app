# SPEC-007 — Architecture audit

**Verdict:** APPROVED_WITH_SHOULDS
**Auditor:** solution-architect subagent
**Date:** 2026-05-25

## Summary

Stage 7 (Goals) — архитектурно консистентен с Stage 5/6, уважает D1-centric
(ADR-011), JWT-only Web Admin (ADR-012), UUID-on-client (ADR-005), spec-driven
flow (ADR-013). DDL и API contract совпадают с §5/§6 spec'а. Worker-модуль
`goals.ts` хорошо структурирован, обобщённый `Result<T>` подтипизирован,
batch atomic delete'а оформлен правильно. Однако реализация **неполная по
SPEC §7 UI**: edit goal / edit manual contribution **не реализованы** (хотя
`useUpdateGoal`/`useUpdateContribution` есть и хуки в queries.ts экспортированы
зря — dead exports). Plus два cache-bug'а (income → goals не инвалидируется
на create/update) и contract drift в `IncomeCreatePayload`. Документация
(roadmap.md, data-model.md) не обновлена для Stage 7 = Goals (продолжает
называть Stage 7 = «Транзакции/обмены»). Найдено: 0 must-fix, 5 should-fix,
6 nice-to-have. Push не блокируется, fix-commit рекомендуется параллельно.

## Must-fix (M)

Нет.

## Should-fix (S)

- **S1. UI · edit goal/contribution не реализован.**
  `GoalDetailPage.tsx:3` импортирует `Pencil` icon, но не использует.
  В заголовке detail-страницы SPEC §7 рисует `[✎] [···] [🗑]`, но `[✎]`
  модал не реализован. Аналогично в таблице contributions: SPEC §7
  рисует `✎ 🗑` для manual-row, но реализован только `🗑` (`GoalDetailPage.tsx:220-224`).
  `queries.ts:194` (`useUpdateGoal`) и `queries.ts:251` (`useUpdateContribution`)
  — dead exports, не подключены. AC не проверяет edit напрямую, но UX в
  §7 на это рассчитан, и при практическом использовании окажется, что
  edit невозможен.
  - Опция A: добавить goal-edit modal + contribution-edit modal в backlog
    и поднять hide-`Pencil`-import до коммита.
  - Опция B: реализовать прямо сейчас (для production-ready stage 7).

- **S2. Cache stale: income mutations не инвалидируют goals.**
  `queries.ts:131-134` (`useCreateIncome`) и `queries.ts:144-148`
  (`useUpdateIncome`) инвалидируют только `["incomes"]`. При создании
  income с `goal_id` UI на `/goals` и `/goals/:id` показывает старый
  balance до ручного reload. Покрывает AC10 на запросе/ответе, но
  ломает UX. Лечится одной строкой:
  ```ts
  qc.invalidateQueries({ queryKey: ["goals"] });
  qc.invalidateQueries({ queryKey: ["goal"] });
  ```
  в `onSuccess` обоих хуков.

- **S3. TypeScript contract drift: `IncomeCreatePayload` без `goal_id`.**
  `types.ts:134-142` (`IncomeCreatePayload`) не объявляет `goal_id`, но
  `IncomeUpdatePayload` (149-152) — объявляет. `IncomesPage.tsx:416`
  передаёт `goal_id` в create-payload через inline-объект → TypeScript
  не проверяет соответствие, кастинг происходит через `onSubmit`
  ad-hoc type. Если рефакторить — может незаметно отвалиться. Добавить
  `goal_id?: string | null` в `IncomeCreatePayload`.

- **S4. Side-effects через `useMemo` вместо `useEffect`.**
  `GoalsPage.tsx:187-192` и `GoalDetailPage.tsx:251-255` используют
  `useMemo` для сброса form-state на `open`. React не гарантирует
  выполнение `useMemo`-callback'а (его можно отбросить ради memory).
  В `IncomesPage.tsx:370-380` тот же reset сделан правильно через
  `useEffect` — есть пример «как надо». Заменить на `useEffect`.

- **S5. Документация: roadmap.md и data-model.md не отражают Stage 7 = Goals.**
  `docs/roadmap.md:77,120,251` продолжает называть Stage 7 «Транзакции/обмены»,
  что должно теперь стать Stage 7.5 / 8. `docs/data-model.md` — без
  упоминания `goals` / `goal_contributions`. SPEC-007 §13 changelog
  существует, но spec-status `in_progress` (не закрыт). После acceptance:
  обновить roadmap (выделить Stage 7 = Goals, Stage 7.5 = Transactions),
  и расширить data-model.md.

## Nice-to-have (N)

- **N1. Helper duplication: `currencyExists`/`accountExists` повторяют
  `categoryExists` из `incomes.ts`.** Если будет 4-й модуль (transactions
  Stage 7.5) — оправдан общий `cloud/worker/src/validators.ts` (или
  `db-helpers.ts`). Сейчас (3 модуля × своя copy) — допустимо по DRY
  правилу «3 повтора ок».

- **N2. `loadRates` в `goals.ts:62-73` берёт per-quote MAX(date)** через
  correlated subquery. Если для разных currency последние даты различны
  (например, USDT в crypto rates обновляется реже), баланс смешает курсы
  разных дат. В `rates.ts:74-85` (`getLatestRates`) есть готовая функция
  с single-date MAX. Использовать её — консистентнее с тем, что Mini App
  / Admin читают для конверсии. Тривиально, но защитит от drift.

- **N3. `status` query-param без валидации.**
  `index.ts:355` кастует `url.searchParams.get("status") as any`. Если
  client пошлёт `?status=banana`, `listGoals` сделает `... AND status = 'banana'`
  → пустой результат без 400. Не security risk (параметризация), но UX
  noise. Whitelist enum через `if (![..., "all"].includes(s)) return 400`.

- **N4. `validateGoalPayload` повторно валидирует name из БД на update.**
  `goals.ts:260-267` подгружает `loadGoalRow` чтобы переподставить name
  для re-валидации FK — это лишний read. Альтернатива: разнести
  валидацию на «полевую» (target_amount/currency/color/deadline format)
  и «FK» (currency existence), и валидировать только то, что в patch.

- **N5. `getGoalDetail` тип возврата `contributions: any[]`.**
  `goals.ts:186, 209-220, 229` — `allRows: any[]` и неявная сборка через
  spread. Извлечь тип `ContributionRowDB` и vернуть `GoalContribution[]`
  чтобы TS-контракт был полным. Связано с `types.ts:174-184` на admin
  стороне — две независимые реализации одного contract'а, рискуют разойтись.

- **N6. `schema.sql` уже снапшот после 0008.** Хорошо. Но: в
  `schema.sql:115` (`incomes.goal_id`) FK ссылается на `goals(id)`, а
  таблица `goals` объявлена ниже (line 127). SQLite позволяет
  «forward» FK при `WITHOUT ROWID` / отложенном создании; в реальной
  миграции 0008 порядок ровно обратный (goals создаётся первой, потом
  incomes.goal_id добавляется через ALTER). Снапшот собирается «как fresh
  install» — порядок CREATE может оказаться важен. Перенести блок goals
  выше incomes для безопасной идемпотентности fresh-bootstrap.

## SPEC conformance

- **G1-G3 (data model):** ✓ Миграция 0008 один-в-один с §5 spec'а.
  CHECK constraints, FK, индексы, soft-delete, sort_order — всё на месте.
- **G4 (CRUD API):** ✓ Все endpoints из §6: GET/POST/PUT/DELETE goals,
  отдельный `POST /:id/status`, CRUD goal-contributions, расширенные
  incomes. Bearer JWT auth через `requireAdminSession` на каждом
  Web-handler'е (`index.ts:352-430`).
- **G5 (GoalsPage):** ✓ Карточки с emoji/color/прогресс/deadline/overdue.
  Edit goal modal — **отсутствует** (S1).
- **G6 (GoalDetailPage):** Частично. Объединённый ledger + edit/delete
  manual contributions работает только наполовину: edit отсутствует (S1).
  Status menu, delete — ✓.
- **G7 (IncomeModal · goal selector):** ✓ Field на `IncomesPage.tsx:454-456`,
  `GoalSelector` подгружает active goals только при открытии модала.
- **G8 (Net worth split):** ✓ `AccountsPage.tsx:30-35,58-76`. Свободно
  = max(0, total − targeted) — защищено от отрицательных. Caveat: при
  goal-balance в валютах без курса (`balance_missing_rates > 0`) сумма
  targeted занижается, но это inherent R1/R3 из §11.
- **G9 (Sidebar):** ✓ `AppLayout.tsx:20` — `{ to: "/goals", icon: Target }`
  между «Доходы» и «Обмены» как описано.
- **G10 (goal без target):** ✓ Card/detail рендерят `formatAmount(balance, ccy)`
  крупно без прогрессбара.

**Acceptance criteria** — на уровне кода:
- AC1-AC18, AC20-21 — реализованы.
- **AC10 risk:** код корректен, но UI cache не инвалидируется (см. S2)
  — балансы не обновятся без reload.
- **AC19 — реализован**, `useGoals("active")` в `IncomeModal`.
- Non-goals (NG1-NG10) — не нарушены: нет negative contributions,
  нет авто-распределения, нет sub-goals, нет Mini App изменений.

## ADR conformance

- **ADR-005 (UUID + INSERT OR IGNORE):** ✓ `goals.id` и
  `goal_contributions.id` — TEXT PK с `crypto.randomUUID()` fallback,
  `INSERT OR IGNORE` обеспечивает идемпотентность (`goals.ts:241-254, 345-357`).
- **ADR-011 (D1 single source):** ✓ Никакого локального state. Все
  computed (balance, missing_rates) считаются on-the-fly в Worker'е через
  D1. Соответствует OQ1 spec'а.
- **ADR-012 (Web Admin + JWT-only):** ✓ Все `/v1/web/goals*` и
  `/v1/web/goal-contributions*` — за `requireAdminSession`. Mini App
  endpoints не получили goals (правильно). NG7 соблюдён.
- **ADR-013 (spec-driven):** ✓ SPEC-007 написан до кода, audit-folder
  организован, changelog spec'а заведён. Документация-side (roadmap.md)
  отстаёт (см. S5).

## Security checklist

- **Auth.** ✓ Все mutating endpoints под Bearer JWT (`requireAdminSession`
  возвращает 401 при отсутствии / истёкшем токене).
- **Input validation.**
  - ✓ `name` trim + non-empty.
  - ✓ `target_amount > 0` через CHECK + Worker re-check.
  - ✓ `target_currency` FK проверена в Worker (`currencyExists`).
  - ✓ `deadline` ISO-format regex `^\d{4}-\d{2}-\d{2}$`.
  - ✓ `color` `#RRGGBB` regex.
  - ✓ `status` enum check в `setGoalStatus`.
  - ✓ `goal_contributions.amount > 0` (CHECK + Worker).
  - ✓ `currency_code`, `account_id`, `goal_id` — все FK через exists-helper.
  - N3: `status` в GET query — не валидирован (см. nice-to-have).
- **SQL injection.** ✓ Все queries — параметризованные `bind(?...)`.
  Динамические части (COALESCE-conditionals для optional updates) — это
  static fragments, не user input.
- **PII в логах.** ✓ В `goals.ts` и `incomes.ts` нет `console.log`
  amount/note/goal_id/email. Worker `index.ts:159` логирует только
  generic `unhandled` без payload.
- **CORS.** ✓ Через `cors.ts:pickAllowedOrigin` — origin echo только
  для whitelist'а `ADMIN_ALLOWED_ORIGINS`. Остальные получают `*` (для
  Mini App — initData HMAC заменяет origin-check). Без изменений в SPEC-007.
- **Cascade transaction.** ✓ `deleteGoal` использует `env.DB.batch([...])`
  — Cloudflare D1 batch гарантирует атомарность (R4 mitigation).

## Code quality

**Что сделано хорошо:**

- Generic `Result<T>` (`goals.ts:38-40`) — отличная типобезопасность для
  возвратов CRUD-функций. Лучше чем `UpdateResult` / `CreateResult`
  ad-hoc в `incomes.ts:76-79, 106-108`. Можно унифицировать в Stage 7.5.
- `validateGoalRef` (`goals.ts:409-413`) — единая точка проверки goal-FK
  для incomes, переиспользована через cross-module import (`incomes.ts:12`).
  Это правильное DRY-извлечение.
- Batch atomic delete (`goals.ts:323-327`) — три UPDATE в одном `batch()`,
  ровно по spec §8 cascade-rules.
- COALESCE pattern + hasField check (`goals.ts:269-296`, `incomes.ts:125-153`)
  для partial PATCH семантики работает корректно. Дублирование есть,
  но это пока 2 модуля → акceptable.

**Что улучшить:**

- S3, S4 (см. выше).
- N1 (helper duplication 3 модуля).
- В `goals.ts:165-176` `aggregate()` определена inline в `listGoals` —
  захватывает closure `balances, goals, rates`. Норм для 1 файла,
  но `getGoalDetail` (line 209-221) повторяет ту же логику для
  одного goal. Можно извлечь `computeBalance(rows, target_currency, rates)`
  и использовать в обоих местах.

## Open questions

- **OQ1.** SPEC §11 R3 решает «target_currency = required при создании,
  даже без target_amount». Текущий код (`goals.ts:97-99`) валидирует
  target_currency только если она передана (`!= null`), и НЕ требует её
  при отсутствии target_amount. Это технически другое поведение: goal
  без target_amount может быть и без target_currency. На UI
  `GoalsPage.tsx:179-180` — `targetCurrency` имеет дефолт `"EUR"`, но
  не отправляется на сервер при `!hasTarget`. Уточнить с автором:
  принять как deliberate departure от R3, или закрыть как баг.

- **OQ2.** `useUpdateGoal` / `useUpdateContribution` экспортируются, но
  не подключены в UI (S1). Намеренно (placeholder для следующего этапа)
  или забыт UI? Если deliberately deferred — пометить в SPEC §12
  «out of scope для этой итерации» и удалить unused exports, либо
  оставить как «backlog» в этой итерации.

- **OQ3.** SPEC §5 пишет, что `goal balance = SUM(incomes) + SUM(contributions),
  converted to goal.target_currency`. В реализации (`goals.ts:171-176`)
  для goal без target_currency используется `currency_code` каждой
  contribution → конверсия не делается, и amounts суммируются без
  приведения. Это значит, что у goal без target_currency с contributions
  в USD + EUR balance получится `USD_sum + EUR_sum` — бессмысленная
  скалярная сумма. R3 spec'а это упоминает, но не дописана логика
  «несколько строк по валютам». Подтвердить решение: либо принудительно
  требовать target_currency (как R3 решает), либо реализовать
  multi-currency balance (out of scope MVP).
