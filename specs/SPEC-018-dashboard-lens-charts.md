---
id: SPEC-018
title: Линза «Свободные / Со всеми фондами» применяется и к графикам истории
status: done
owner: stepan
created: 2026-05-28
updated: 2026-05-28
links:
  - parent: SPEC-015
---

# Линза дашборда → графики истории

## 1. Context & Problem

В SPEC-015 (Dashboard v2) линза «Свободные ↔ Со всеми фондами» применяется к KPI «Сейчас» (Net worth, Runway, Доход, Норма) и к **одной** спарклайне (`nwSpark` — net worth). Главные графики «История за период» — **Net worth по времени** и **Доходы vs Расходы** — игнорируют линзу: всегда показывают total и весь доход. Пользователь на линзе «Свободные» видит KPI 8 019 € (без фондов), а график рисует 10 451 € (с фондами) — несостыковка. Попутно: спарклайны KPI «Доход» и «Норма сбережений» (`incSpark`/`srSpark`) тоже не реагируют на линзу.

## 2. Goals

- **G1**: График **Net worth по времени** под линзой «Свободные» рисует приближение `total − targeted` (как уже делает sparkline net worth в KPI); под «Со всеми фондами» — `total`.
- **G2**: График **Доходы vs Расходы** под «Свободные» показывает **доход без `goal_id`** (поток per month); расходы линза не меняет.
- **G3**: Спарклайны KPI «Доход / мес» и «Норма сбережений» реагируют на линзу (consistency с net-worth-spark).
- **G4**: Без миграций D1.

## 3. Non-Goals

- **NG1**: Точная история goal balance per month — не реконструируем (известный OQ SPEC-015). `free` в Net worth chart — это аппроксимация `total − currentTargeted` (одинаковый сдвиг для всех месяцев), не «free net worth на момент M». Это та же аппроксимация, что в спарклайне KPI и в `prev_free_net_worth_eur`.
- **NG2**: **Отдельный график на целевые фонды** (отдельная шкала / отдельная серия) — отложен в backlog. Появится, если возникнет конкретная потребность видеть динамику фондов.
- **NG3**: Линза не меняет toggle «Форма/Валюта» / breakdown by_bucket — они показывают физические балансы вёдер, без вычета целевых.

## 4. User journeys

### Happy
1. Открываю дашборд, линза по дефолту «Свободные» — Net worth chart рисует кривую без целевых фондов; Доходы vs Расходы показывает свободный доход (без goal-помеченного).
2. Переключаю на «Со всеми фондами» — графики перерисовываются на полный net worth и весь доход.
3. Спарклайны KPI «Доход/мес» и «Норма» меняются вместе с линзой.

### Edge
- **E1**: Targeted = 0 (нет активных целей) → разница между линзами отсутствует визуально.
- **E2**: Месяц без доходов → `income_free_eur = 0` (как и `income_eur`).

## 5. Data model

Без миграций. Worker уже грузит `goal_id` в `IncRow`.

## 6. API contract

### `GET /v1/web/dashboard` — additive
- `cashflow_series[].income_free_eur: number` — доход без goal-помеченного per month (поток, date-aware EUR). `income_eur` без изменений.

## 7. UI / UX

- `NetWorthChart` — принимает `lens`; данные = `p.total_eur` либо `p.total_eur - kpi.targeted_eur` (clamped по нижней границе 0).
- `CashflowChart` — принимает `lens`; income-серия = `p.income_eur` либо `p.income_free_eur`; expense — без изменений.
- KPI спарклайны `incSpark`/`srSpark` используют `income_free_eur` при free.
- Подпись над net-worth-графиком в free-режиме: «без целевых фондов (≈)» — лёгкий ярлык-намёк на аппроксимацию (тонкая каптион). Не блокер.

## 8. Security

Без новых endpoints / auth изменений. Только additive поле в response.

## 9. Acceptance criteria

- [ ] **AC1**: Линза «Свободные» — Net worth chart рисует `total − targeted` ≥ 0 (графически совпадает с `nwSpark` в KPI).
- [ ] **AC2**: Линза «Со всеми фондами» — Net worth chart рисует `total_eur` (текущее поведение).
- [ ] **AC3**: Линза «Свободные» — Cashflow chart income использует `income_free_eur` per month.
- [ ] **AC4**: Линза «Со всеми фондами» — Cashflow chart income использует `income_eur` per month.
- [ ] **AC5**: Спарклайны KPI «Доход / мес» и «Норма сбережений» реагируют на линзу (free → income_free).
- [ ] **AC6**: Tooltip графика показывает значения, согласованные с выбранной линзой (не путает свободный и полный).
- [ ] **AC7**: Без миграций; tsc/build green; test_admin_ui — скриншоты обеих линз (`admin-dashboard.png` free + `admin-dashboard-total.png` total) показывают разные кривые при ненулевом targeted.

## 10. Test plan

- Worker: typecheck.
- Admin: lint/build + Playwright (test_admin_ui) — обе линзы. Сценарии `admin-dashboard.png` (free) и `admin-dashboard-total.png` (total) уже есть; проверить, что Net worth-кривая и cashflow-bars различаются.
- Regression: KPI цифры по линзе остались как были; tooltip Net worth / cashflow корректен.

## 11. Risks & open questions

- **R1**: `free` net worth = `max(0, total − targeted)` — clamp по нулю, чтобы при нескольких маленьких отрицательных вёдрах + большом targeted линия не уходила в минус. Это аппроксимация, не точная реконструкция.
- **OQ1** (наследуется из SPEC-015): историческое targeted per month — не реконструируем; берём текущий `targeted_eur`. Если когда-нибудь добавим history goal balance — заменим аппроксимацию на точное.

## 13. Changelog

- 2026-05-28: создан, сразу в `in_progress` (одобрено устно).
- 2026-05-28: реализовано, скриншоты подтвердили AC1/AC2 (разные кривые между линзами). Push f85af71 → deploy worker 68a02d89 + admin 35c5c691. `done`.
