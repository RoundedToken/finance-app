---
id: SPEC-013
title: Stage 8 — Главный дашборд (Web Admin)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-06-01
links:
  - adr: docs/decisions.md#adr-006   # rates pipeline (EUR base)
  - adr: docs/decisions.md#adr-012   # Web Admin
  - depends_on: [SPEC-005, SPEC-006, SPEC-007, SPEC-008, SPEC-011]
---

# Stage 8 — Главный дашборд (Web Admin)

## 1. Context & Problem

Все базовые потоки закрыты (расходы, доходы, снапшоты, цели, обмены), и математика
строгая после SPEC-011 (`effective_balance = manual baseline + Σ events`). Но цифры
живут по разным страницам — нет единого экрана «как у меня дела». `DashboardPage`
сейчас заглушка. Нужен сводный экран: net worth, сколько трачу/получаю, на сколько
хватит подушки, и как это менялось во времени — всё в одной базовой валюте (EUR).

## 2. Goals

- **G1**: На `/` (DashboardPage) видны 5 KPI: net worth (со split «Свободно / Целевые»), monthly burn, monthly income, savings rate, runway — все в EUR-эквиваленте.
- **G2**: Три графика: net worth over time (помесячно, 12 мес), income vs expenses (помесячно), expenses by category (за период).
- **G3**: Мультивалютная консолидация **date-aware** — историческая сумма конвертируется по курсу на дату операции / на конец месяца, а не по сегодняшнему. Net worth «в прошлом» не плывёт при колебаниях валют.
- **G4**: Фильтры: период (PeriodPicker), тип/форма счёта, категория расходов — применяются к KPI и графикам консистентно.
- **G5**: Один агрегирующий endpoint `GET /v1/web/dashboard`; вся тяжёлая математика на сервере, клиент только рисует. Без новых таблиц/миграций.

## 3. Non-Goals

- **NG1**: Никаких новых таблиц/миграций D1 — только агрегация существующих данных.
- **NG2**: Не трогаем Mini App (scope зафиксирован, CLAUDE.md §11).
- **NG3**: Не делаем переключаемую базовую валюту — только EUR (как уже на `AccountsPage`).
- **NG4**: Не делаем экспорт (CSV/PDF), drill-down-страницы по клику в графике, и кастомные дашборд-виджеты/layout. Клик по сегменту максимум подсвечивает, не навигирует.
- **NG5**: Не делаем sparklines на карточках `/accounts` (это Stage 5b, после Stage 8).
- **NG6**: Не вводим инвестиционный yield / holdings (Stage 9).
- **NG7**: Не кэшируем агрегат на стороне D1/KV — пересчёт на каждый запрос (объёмы малы, см. §11).

## 4. User journeys

### Happy path
1. Захожу в Admin → открывается `/` (Dashboard).
2. Вижу строку из 5 KPI-карточек: Net worth (крупно, EUR; под ним «Свободно X / Целевые Y»), Monthly burn, Monthly income, Savings rate, Runway.
3. Ниже — график **Net worth over time** (помесячная линия/area за 12 мес, EUR).
4. Рядом/ниже — **Income vs expenses** (парные столбцы по месяцам) и **Expenses by category** (donut/бары за период).
5. Меняю период в PeriodPicker (напр. «Год» → «Всё») — графики и зависящие от периода KPI (burn/income/savings) пересчитываются.
6. Включаю фильтр «только наличка» или выбираю категорию — net worth и breakdown сужаются соответственно.

### Edge cases
- **E1 (пустые данные)**: нет снапшотов/доходов/расходов → KPI показывают `—` / `0 €`, графики — empty-state «Нет данных за период», без падения.
- **E2 (нет manual baseline у ведра)**: `effective_balance` считается от 0 + события (как в SPEC-011). Дашборд это не маскирует; net worth может быть «неполным» — показываем тот же warning-баннер, что и на `/accounts`, если есть вёдра без baseline (ссылка на `/snapshots`).
- **E3 (отсутствует курс для валюты на дату)**: операция в валюте без курса на нужную дату → исключается из EUR-суммы, но учитывается счётчик `missing_rates`; в UI — ненавязчивый бейдж «N операций без курса». Не роняем весь дашборд.
- **E4 (burn = 0)**: runway не вычислим → показываем `∞` с пояснением «нет трат за период».
- **E5 (income = 0)**: savings rate не вычислим → `—`.
- **E6 (401)**: SPA очищает токен и редиректит на `/login` (общий перехватчик, как на других страницах).
- **E7 (5xx / network)**: страница показывает error-state с кнопкой «Повторить», не белый экран.
- **E8 (текущий месяц неполный)**: monthly burn/income считаются по **последним N полным календарным месяцам**, текущий неполный месяц исключён, чтобы не занижать средние.

## 5. Data model

**Изменений в D1 нет.** Дашборд агрегирует существующие таблицы: `accounts`,
`snapshots` (source='manual'), `incomes`, `expenses`, `transactions`,
`goal_contributions`, `goals`, `rates`, `categories`.

Базовая валюта консолидации — **EUR** (как в `rates.base` и `AccountsPage`).
Курс хранится как `1 EUR = rate × quote`; перевод суммы `X` валюты `q` в EUR: `X / rate(q)`.

### Date-aware конверсия (ядро фичи)

In-memory lookup внутри Worker, чтобы избежать N запросов:
1. Один раз грузим **все** строки `rates` (date, quote, rate) и строим для каждой `quote` отсортированный по дате массив.
2. `rateAt(quote, date)` = последний `rate` с `rate.date ≤ date` (ближайший раньше), `EUR → 1`. Если для quote нет ни одной записи ≤ date → `null` (→ `missing_rates`).
3. `toEurAt(amount, quote, date) = amount / rateAt(quote, date)`.

Это серверный аналог уже существующего `getRateAt()` (rates.ts), но батч-загруженный.

## 6. API contract

### `GET /v1/web/dashboard`
- **Auth**: JWT (Bearer) через `requireAdminSession`.
- **Query**:
  - `from`, `to` — ISO `YYYY-MM-DD`, границы периода для графиков и для period-зависимых KPI. Если не заданы — дефолт: `to = today`, `from = today − 12 месяцев` (начало месяца 11 месяцев назад).
  - (тип счёта / категория **не** параметры — фильтрация на клиенте, см. §7.)
- **Семантика валют**: все `*_eur` поля — EUR, date-aware (по курсу на дату операции либо конец соответствующего месяца).
- **Response 200**:
  ```json
  {
    "as_of": "2026-05-25",
    "base": "EUR",
    "rates_date": "2026-05-25",
    "window": { "from": "2025-06-01", "to": "2026-05-25", "months": 12 },

    "kpi": {
      "net_worth_eur": 12345.67,
      "free_net_worth_eur": 9000.00,
      "targeted_eur": 3345.67,
      "monthly_burn_eur": 1500.00,
      "monthly_income_eur": 2200.00,
      "savings_rate": 0.318,
      "runway_months": 6.0,
      "runway_months_total": 8.2,
      "burn_window_months": 3,
      "buckets_without_baseline": 1,
      "missing_rates": 0
    },

    "net_worth_series": [
      { "month": "2025-06", "total_eur": 8000.0,
        "by_bucket":   { "<account_id>": 1234.5 },
        "by_form":     { "cash": 500.0, "digital": 7000.0, "crypto": 500.0 },
        "by_currency": { "EUR": 6000.0, "RSD": 1500.0, "USDT": 500.0 } }
    ],

    "cashflow_series": [
      { "month": "2025-06", "income_eur": 2000.0, "expense_eur": 1400.0 }
    ],

    "expenses_by_category": [
      { "category_id": "food", "name": "Еда", "emoji": "🍔", "color": "#f00",
        "total_eur": 540.0, "share": 0.36 }
    ],

    "buckets": [
      { "id": "<account_id>", "name": "RSD нал", "form": "cash",
        "type": "cash", "currency": "RSD", "color": "#..." }
    ]
  }
  ```
- **Response 401**: `{ "error": "unauthorized" }` — SPA чистит токен, редирект на `/login`.
- **Response 5xx**: generic error (без stack-trace в body, см. §8). UI → error-state.

### Метрики — точные определения

Период для KPI burn/income/savings = **последние `burn_window_months = 3` полных календарных месяца** (текущий неполный исключён, см. E8). `net_worth` — всегда «сейчас» (as_of=today), не зависит от периода-фильтра.

- **net_worth_eur** = `Σ_buckets toEurAt(effective_balance(bucket, today), bucket.currency, today)`. `effective_balance` — как в SPEC-011 (`snapshots.ts:getEffectiveBalance`).
- **targeted_eur** = `Σ_активные_goals toEurAt(goal.balance, goal.target_currency, today)` (balance из `listGoals`, см. goals.ts).
- **free_net_worth_eur** = `net_worth_eur − targeted_eur` (может быть отрицательным — это сигнал, как на `/accounts`).
- **monthly_burn_eur** = `(Σ expenses за 3 полных мес, каждая toEurAt по дате траты) / 3`.
- **monthly_income_eur** = `(Σ incomes за те же 3 мес, toEurAt по дате) / 3`.
- **savings_rate** = `(monthly_income_eur − monthly_burn_eur) / monthly_income_eur`; если `monthly_income_eur ≤ 0` → `null` (UI: `—`).
- **runway_months** = `free_net_worth_eur / monthly_burn_eur` (основное число); **runway_months_total** = `net_worth_eur / monthly_burn_eur` (мелким в подписи, D1). Если `monthly_burn_eur ≤ 0` → `null` (UI: `∞`). Отрицательный free net worth → `0`.
- **Точка net_worth_series[m]** = net worth на **конец месяца m**: для каждого ведра `effective_balance(bucket, endOf(m))` (baseline ≤ endOf(m) + события ≤ endOf(m)), → EUR по `rateAt(currency, endOf(m))`.
- **cashflow_series[m]** = суммы incomes/expenses за календарный месяц m, toEurAt по дате каждой операции.
- **expenses_by_category** = расходы за период `[from, to]`, сгруппированы по `category_id`, toEurAt по дате; `share` = доля от суммы периода.

### Реализация (notes, не контракт)
Новый модуль `cloud/worker/src/dashboard.ts`:
- Грузит батчем: manual snapshots, incomes, expenses, transactions, goal_contributions (за всё время — нужно для running balance), все rates, активные goals (через `listGoals`), buckets (`listBuckets`), expense-категории.
- Считает помесячный running balance per bucket в JS (≈6 D1-запросов суммарно вместо сотен).
- Endpoint `handleWebDashboard` в `index.ts` по паттерну остальных web-handlers.

## 7. UI / UX

Переписываем `cloud/admin/src/routes/DashboardPage.tsx`. Графики — `echarts-for-react`
(уже в deps). Переиспользуем `PeriodPicker`, `Currency`, `formatAmount`, `cn`, токены `card`.

```
┌───────────────────────────────────────────────────────────────┐
│  Дашборд  ── Сейчас (KPI) ───────────────────────  [↻ обновить] │
│  ── История за период ──  [12м 6м Год Всё ▸] [Форма] [Категория]│
├───────────────────────────────────────────────────────────────┤
│ ┌─ Net worth ─┐ ┌─ Burn/мес ─┐ ┌─ Доход/мес ┐ ┌ Savings ┐ ┌ Runway ┐ │
│ │ 12 345 €    │ │ 1 500 €    │ │ 2 200 €     │ │  32 %   │ │ 6.0 мес│ │
│ │ своб 9 000  │ │ ср. 3 мес  │ │ ср. 3 мес   │ │         │ │        │ │
│ │ цели 3 345  │ └────────────┘ └─────────────┘ └─────────┘ └────────┘ │
│ └─────────────┘                                                       │
├───────────────────────────────────────────────────────────────┤
│  Net worth по времени (12 мес)        [ total · форма · валюта ] │
│  [линия total (дефолт); toggle → stacked area по форме / валюте] │
├───────────────────────────────────────┬───────────────────────┤
│  Доходы vs Расходы (по месяцам)        │  Расходы по категориям │
│  [парные столбцы income/expense]       │  [donut + легенда]     │
└───────────────────────────────────────┴───────────────────────┘
```

Состояния:
- **loading**: skeleton-карточки + skeleton-блоки графиков (как на `/accounts`).
- **empty**: KPI = `—`/`0 €`, в каждом графике плашка «Нет данных за период».
- **error**: блок с текстом ошибки + кнопка «Повторить» (refetch).
- **missing baseline**: amber-баннер сверху (переиспользовать стиль `AccountsPage`), ссылка `/snapshots`.
- **missing rates**: маленький бейдж рядом с затронутым графиком/KPI.

Период — компактный селектор пресетов **12м / 6м / Год / Всё / Период** (дефолт «12 мес»), в визуальном стиле PeriodPicker. PeriodPicker как есть не подошёл: Мес/Нед/30д семантически не про дашборд и в нём нет «последние N месяцев» (см. §11 D5).

Фильтры (клиентская сторона, поверх ответа сервера) — живут в блоке «История», KPI-блок «Сейчас» не трогают (согласно D4):
- **Период** → меняет `from`/`to` в query, рефетч; влияет на все 3 графика + breakdown.
- **Форма счёта** (multi) → только график «Net worth по времени» (сужение вёдер через `by_bucket` + `buckets[].form`); в режиме «валюта» не применяется (ortho-измерение).
- **Категория** (multi) → только donut «Expenses by category» (сужение + пересчёт долей).
- Cross-фильтрация (категория → расходная часть cashflow) требует куба месяц×категория — вне MVP (см. §11 D6).

Цвета: brand-токены + `category.color`/`account.color` где есть. Числа — `tabular-nums`,
формат через `formatAmount`. Currency-бейдж EUR через `<Currency code="EUR" />`.

## 8. Security

- **Auth**: `requireAdminSession` (JWT Bearer) на `GET /v1/web/dashboard` — обязательно, как у всех `/v1/web/*`. Read-only, мутаций нет.
- **Input validation**: `from`/`to` — проверка на ISO `YYYY-MM-DD` (regex), иначе игнорируем и берём дефолт (не 500). `from ≤ to`; иначе своп или дефолт.
- **Утечки**: 5xx → generic `{ "error": "internal" }`, без `String(err)` в body (избегаем известного leak'а `index.ts:113`); детали — в `console.error`.
- **PII / финданные**: суммы и категории — чувствительны, но канал уже за JWT-allowlist (`ADMIN_ALLOWED_EMAILS`). Не логировать суммы/payload в телеметрию.

## 9. Acceptance criteria

- [ ] **AC1**: `GET /v1/web/dashboard` без `Authorization` → 401; с валидным JWT → 200 + структура из §6.
- [ ] **AC2**: `net_worth_eur` совпадает (±0.01) с суммой `≈ EUR` карточек на `/accounts` при текущих курсах (sanity-кросс-чек). Split `free + targeted = net_worth`.
- [ ] **AC3**: На `/` рендерятся 5 KPI-карточек с реальными значениями; пустые/невычислимые → `—`/`∞` без падения.
- [ ] **AC4**: Три графика рендерятся (echarts); при отсутствии данных — empty-state, не белый экран / не JS-ошибка.
- [ ] **AC5**: Смена периода в PeriodPicker меняет окно `net_worth_series`/`cashflow_series`/`expenses_by_category` и пересчитывает burn/income/savings/runway.
- [ ] **AC6**: Date-aware проверяемо: операция в RSD из прошлого даёт в `cashflow_series` EUR-сумму по курсу того месяца, не по сегодняшнему (отличие при заметном дрейфе курса).
- [ ] **AC7**: Фильтр «форма=наличка» уменьшает `net worth` график/KPI до суммы только cash-вёдер; снятие — возвращает полную.
- [ ] **AC8**: Фильтр по категории сужает donut и расходную часть income-vs-expenses.
- [ ] **AC9**: Есть вёдра без baseline → amber-баннер со ссылкой `/snapshots`; есть операции без курса → бейдж `missing_rates`.
- [ ] **AC10**: 401 на дашборде → редирект `/login`; 5xx → error-state с «Повторить»; в body 5xx нет stack-trace.
- [ ] **AC11**: Sidebar-пункт «Дашборд» активен на `/` (`useRouterState`, не застревает).
- [ ] **AC12**: Перф: один запрос `/v1/web/dashboard` на текущем объёме данных делает ≤ ~10 D1-запросов (батч-загрузка), не сотни.

## 10. Test plan

- **Worker**: curl smoke (401 без токена, 200 с токеном, форма ответа); юнит-проверка `toEurAt`/`rateAt` (ближайший раньше, EUR=1, missing→null); кросс-чек `net_worth_eur` против `effectiveBalancePerAccount` + latest-rate суммы.
- **Admin SPA**: Playwright + ручной walkthrough — рендер KPI, графиков, смена периода, фильтры форма/категория, empty/error/loading.
- **Date-aware**: подобрать месяц с заметным дрейфом RSD/EUR, сверить EUR-сумму месяца с ручным расчётом по `rateAt`.
- **Regression**: `/accounts` (net worth split не изменился), `/expenses`, `/incomes`, `/transactions`, `/goals` — не затронуты; Mini App — не затронут.

## 11. Risks & open questions

- **R1 (перф net worth over time)**: наивно — сотни D1-запросов. Митигировано батч-загрузкой всех событий + in-memory running balance (§6 notes, AC12).
- **R2 (date-aware дороже)**: in-memory rates-индекс строится один раз на запрос; ~4–5k строк rates — дёшево.
- **R3 (расхождение с `/accounts`)**: `/accounts` консолидирует по **latest** rate на клиенте, дашборд `net_worth` — тоже по `today`/latest, поэтому AC2 должен сходиться. Историю (series) считаем date-aware — это сознательное различие «точка сейчас vs история».
- **D1 (OQ1, решено 2026-05-25)**: Runway основное число = `free_net_worth / burn` (за вычетом целевых фондов); в подписи мелким — полный `net_worth / burn` (`runway_months_total`). Видны обе картины.
- **D2 (OQ2, решено)**: Окно burn/income/savings = **3 полных календарных месяца** (текущий неполный исключён). Savings rate — за то же окно.
- **D3 (OQ3, решено)**: Net worth over time — **линия total по умолчанию** + переключатель на stacked area с под-выбором разбивки **форма / валюта** (поэтому в ответе и `by_form`, и `by_currency`). Устойчиво к отрицательным вёдрам.
- **D4 (OQ4, решено)**: KPI burn/income/savings/runway всегда «последние 3 полных месяца», **не** зависят от PeriodPicker; период двигает только графики + `expenses_by_category`. Блоки «Сейчас» (KPI) и «История за период» (графики) визуально разделены.
- **D5 (реализация Phase 2)**: Период — собственный селектор пресетов 12м/6м/Год/Всё/Период (дефолт 12м) в стиле PeriodPicker, т.к. общий PeriodPicker (Мес/Нед/30д) семантически не про дашборд и не имеет «последние N месяцев». Общий компонент не трогаем — нет регрессий на других страницах.
- **D6 (MVP-упрощение)**: Фильтр формы влияет только на график net worth; фильтр категории — только на donut. Cross-фильтрация (категория → cashflow) отложена (нужен куб месяц×категория).

## 12. Out of scope для review

- `data-model.md` полный апдейт (tech-debt, отдельно) — дашборд не вводит схему.
- Date-aware конверсия в `/accounts` и goal balance (остаются latest-rate; рефактор — отдельный tech-debt тикет).
- Унификация deactivation logic (`deleted_at` vs `is_active`) — наследие, не в scope.

## 13. Changelog spec'а

- 2026-05-25: создан в `draft`.
- 2026-05-25: OQ1–OQ4 решены (см. §11 D1–D4), одобрен → `in_progress`.
- 2026-05-25: Phase 2 — реализация (worker `dashboard.ts` + endpoint; admin `queries`/`types`/`DashboardPage`). Уточнения D5/D6. typecheck + build зелёные.
- 2026-05-25: Phase 3 — senior-qa PASS_WITH_NICES + solution-architect APPROVED_WITH_NICES, 0 блокеров. Fix: missing_rates (E3 покрытие net worth + убран double-count), D6 пересчёт долей легенды, empty-state net worth chart, a11y/UX мелочи. Nice-to-have → roadmap tech-debt.
- 2026-06-01: `status` → `done` (синхрон фронтматтера: фича давно в проде, статус застрял на `in_progress` — дрейф доков).
