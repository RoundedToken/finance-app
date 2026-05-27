---
id: SPEC-016
title: Канонический слой конвертации валют — запас (mark-to-market) vs поток (date-aware)
status: in_progress
owner: stepan
created: 2026-05-27
updated: 2026-05-27
links:
  - adr: docs/decisions.md#adr-014
  - depends_on: [SPEC-011, SPEC-013]
---

# Канонический слой конвертации валют

## 1. Context & Problem

Конверсия сумм в EUR размазана по коду в трёх несовместимых вариантах:
1. **date-aware** (правильно) — `dashboard.ts`, `incomes.ts` через `RatesIndex` (курс на дату операции / конец месяца);
2. **latest-global на worker** — `goals.ts` через `loadRates()` = `MAX(date)` per quote + `convertVia()` без даты;
3. **latest-snapshot на клиенте** — `AccountsPage`, `ExpensesPage`, Mini App `DayTotal` через `refs.rates.quotes` (один snapshot на глобальный `MAX(date)`).

Это даёт расхождение цифр между страницами (особенно RUB-вёдра — курс сильно двигался 2024–2026) и **баг**: клиентская конверсия по глобальному `MAX(date)`-snapshot возвращает **0**, если по валюте нет курса ровно на эту дату (а `getLatestRates` берёт строки только за одну дату `MAX(date)`). Нужно зафиксировать единый правильный механизм — раз и навсегда, чтобы будущий код не плодил четвёртый вариант.

## 2. Goals

- **G1**: Единый canonical util (`RatesIndex` в `rates.ts`) — единственный путь перевести сумму в EUR / другую валюту. Вся конверсия на worker; клиент не конвертит, а получает готовые `*_eur` поля.
- **G2**: Модель двух классов закреплена в коде и ADR-014:
  - **Запас** (баланс в моменте: вёдра, net worth, goal balance) → курс **на сегодня** (mark-to-market).
  - **Поток** (операция на дату: расход, доход, day-total) → курс **на дату операции** (date-aware).
- **G3**: Убран клиентский latest-баг (0 при отсутствии курса на глобальный `MAX(date)`) — заменён per-quote `rateAt(today)` с fallback на ближайший курс ≤ нужной даты.
- **G4**: Цифры консистентны между `/accounts`, `/goals`, `/dashboard`, `/expenses` и Mini App для одной даты курсов.
- **G5**: Без миграций D1.

## 3. Non-Goals

- **NG1**: Не меняем **семантику** goal balance — остаётся текущая стоимость (mark-to-market today), как и было; меняется только источник курса (canonical, per-quote вместо global-MAX).
- **NG2**: Не тащим историчность в запасы (цели / вёдра / net worth «сейчас») — там today-rate, **не** курс-на-дату-взноса.
- **NG3**: Не трогаем dashboard net worth series / KPI (уже date-aware корректно).
- **NG4**: Не трогаем `formatExchangeRate` (отображение курса обмена в transactions — это не EUR-конверсия).
- **NG5**: Не добавляем UI для ручного ввода / редактирования курсов.

## 4. User journeys

### Happy path
1. Открываю **/accounts**: net worth, split «Свободно / Целевые фонды», баланс каждого ведра в EUR — посчитаны на worker по сегодняшнему курсу (per-quote). Совпадают с KPI «Сейчас» на /dashboard.
2. Открываю **/expenses**: EUR-эквивалент каждой траты — по курсу **даты траты** (трата 2024 в RUB показывает EUR того периода, а не сегодняшний).
3. Открываю **историю в Mini App**: day-total «≈ X EUR» — по курсу того дня.
4. Открываю **/goals**: баланс цели — текущая стоимость всех взносов по сегодняшнему курсу.

### Edge cases
- **E1**: По валюте нет курса ровно на нужную дату → берётся ближайший с `date ≤ target` (`RatesIndex.rateAt` бинпоиск). Не 0.
- **E2**: Курса нет вообще (дата раньше первого backfill 2024-01-10) → позиция/операция не конвертится, попадает в счётчик «N без курса», не роняет тотал в 0 молча.
- **E3**: Курсы устарели (cron не отработал) → `rateAt(today)` берёт последний доступный ≤ today. Net worth не обнуляется.
- **E4**: EUR-сумма → `rate = 1`, без обращения к таблице.

## 5. Data model

Изменений схемы D1 **нет**. Используется существующая `rates(date, base='EUR', quote, rate)`. Без миграций.

## 6. API contract

Изменения shape ответов — **additive** (обратносовместимо: новые поля, старые не удаляются).

### `GET /v1/web/accounts` (изменено)
- Auth: JWT (Bearer).
- Добавлены поля:
  - `accounts[].effective_balance_eur: number` — баланс ведра в EUR по `rateAt(today)`.
  - `summary: { net_worth_eur, free_eur, targeted_eur, missing_rates }` — посчитаны на worker.
- `net_worth_eur = Σ effective_balance_eur`; `targeted_eur = Σ goal.balance → EUR by today`; `free_eur = net − targeted`.

### `GET /v1/web/expenses` + `GET /v1/expenses` + `GET /v1/bootstrap` (изменено)
- Все через общий `listExpenses` (db.ts).
- Добавлено `expenses[].amount_eur: number | null` — date-aware по дате траты (как `incomes.amount_eur`). `null` если курса нет.

### `GET /v1/web/goals`, `GET /v1/web/goals/:id` (shape без изменений)
- `balance` теперь считается через canonical `RatesIndex.rateAt(today)` вместо `loadRates(MAX date)`. Поле и смысл те же (текущая стоимость).

Auth — без изменений (JWT для `/web/*`, initData для Mini App / bootstrap).

## 7. UI / UX

- **AccountsPage**: убрать клиентский `toEur` / `refs.rates`; рендерить `effective_balance_eur` + `summary` из ответа. Визуально то же, но цифры корректны (RUB-вёдра не 0).
- **ExpensesPage**: `eur_equivalent ← e.amount_eur`; `totalEur = Σ amount_eur`. Подпись «Дата курсов» → пояснение, что EUR по курсу даты траты.
- **Mini App `DayTotal`**: `baseTotal = Σ rows.amount_eur` (date-aware) вместо `toBase(latest)`. Нативные суммы по валютам — без изменений.

## 8. Security

- Без новых endpoints / auth. Существующие проверки сохраняются.
- `amount_eur` / `*_eur` — производные от `amount + rate`, не PII сверх существующего.
- Без новых secrets, без записи в логи.

## 9. Acceptance criteria

- [ ] **AC1**: `rates.ts` — единственное место rate-арифметики; `goals.ts` / `AccountsPage` / `ExpensesPage` / `DayTotal` не содержат собственной конверсии (`amount / rate`).
- [ ] **AC2**: `/v1/web/accounts` возвращает `effective_balance_eur` + `summary.{net_worth_eur,free_eur,targeted_eur}`; `AccountsPage` не импортирует `refs.rates` для конверсии.
- [ ] **AC3**: RUB-ведро с балансом и устаревшим (не сегодня) последним курсом показывает корректный EUR, **не 0**.
- [ ] **AC4**: `/v1/expenses` и `/v1/web/expenses` возвращают `amount_eur` по курсу **даты траты**; трата в RUB за 2024 даёт EUR по курсу 2024, не сегодняшнему.
- [ ] **AC5**: Mini App day-total для исторического дня = Σ `amount_eur` того дня (курс дня), не latest.
- [ ] **AC6**: Goal balance = текущая стоимость (today rate); `free = net − targeted` сходится (обе величины «сейчас»).
- [ ] **AC7**: net worth «сейчас» на `/accounts` == `net_worth_eur` KPI на `/dashboard` для одной даты курсов.
- [ ] **AC8**: Нет миграций D1; `gitleaks dir` clean.
- [ ] **AC9**: ADR-014 фиксирует модель двух классов + правило worker-side конверсии; `rates.ts` имеет doc-comment с этим правилом.

## 10. Test plan

- **Worker**: curl smoke — `/v1/web/accounts` (`effective_balance_eur` ≠ 0 для непустых RUB-вёдер), `/v1/web/expenses` (`amount_eur` по дате), `/v1/web/goals` (`balance`).
- **Admin SPA**: `local/scripts/test_admin_ui.py` (Playwright + mock JWT) — /accounts (net worth ≠ 0, split), /expenses (EUR-колонка), скриншоты light/dark.
- **Mini App**: `local/scripts/test_miniapp_react.py` — история, day-total «≈ EUR» на старом дне.
- **Regression**: dashboard KPI / series без изменений (сравнить до/после); `incomes.amount_eur` не сломан.

## 11. Risks & open questions

- **R1**: Производительность — `loadRatesIndex` грузит все курсы (~4000+ строк). Уже используется dashboard / incomes; для `/accounts` / `goals` добавляет один батч-запрос. Приемлемо (single-user).
- **R2** (tech debt): net worth «сейчас» считается независимо в `/accounts` и в dashboard KPI. Формула SPEC-011 одна → цифры сойдутся, но код дублирован. Вынос общего aggregator отложен (разные perf-профили: dashboard — большой in-memory батч, /accounts — `effectiveBalancePerAccount` N+1 по 7 вёдрам).
- **OQ1** (resolved): Mini App `baseCurrency` — в store дефолт EUR, но **UI-переключателя нет** (никто не диспатчит `{t:"baseCurrency"}`), т.е. base = EUR де-факто. `DayTotal` суммирует `amount_eur` напрямую; мёртвый клиентский `toBase` (latest) удалён вместе с `lib/money.ts`. Если когда-нибудь добавят переключатель base — делать date-aware EUR→base на worker (`convertAt`), не возвращать latest-конвертер.
- **R3** (resolved): goal balance семантика — выбрана mark-to-market (текущая стоимость), решение Stepan'а 2026-05-27.

## 13. Changelog spec'а

- 2026-05-27: создан в `draft`.
- 2026-05-27: одобрен Stepan'ом, переведён в `in_progress`.
