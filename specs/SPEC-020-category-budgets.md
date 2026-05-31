---
id: SPEC-020
title: Бюджеты / лимиты по категориям — месячная поведенческая петля «сколько ещё можно потратить»
status: done
owner: stepan
created: 2026-05-31
updated: 2026-05-31
links:
  - adr: docs/decisions.md#adr-014
  - adr: docs/decisions.md#adr-015
  - depends_on: [SPEC-011, SPEC-013, SPEC-016, SPEC-017]
  - roadmap: docs/post-mvp-roadmap.md#фаза-2 (пункт 2.2)
---

# Бюджеты / лимиты по категориям

## 1. Context & Problem

В системе закрыты все пути учёта (траты, доходы, обмены, снапшоты, цели, дашборд), но **отсутствует единственная поведенческая петля**: «сколько мне ещё можно потратить в этом месяце». Дашборд отвечает на «сколько потратил» (donut `expenses_by_category`, EUR, date-aware), но не на «сколько осталось до лимита». Это пункт **2.2 пост-MVP roadmap** — помечен как «единственная отсутствующая поведенческая петля».

Всё нужное для расчёта уже есть: per-category EUR-суммы за период считаются в `dashboard.ts` (`catTotals` через `RatesIndex.toEurAt`, date-aware по дате траты, ADR-014). Не хватает: (а) хранилища лимитов, (б) сравнения факт/лимит за текущий месяц с понятным статусом good/warn/over, (в) экрана в Admin и подсказки при вводе в Mini App.

## 2. Goals

- **G1**: Пользователь задаёт **месячный лимит в EUR** на расходную категорию (и опционально один **общий месячный потолок** на все траты). Лимит — recurring: применяется к каждому календарному месяцу, отдельной истории по месяцам нет.
- **G2**: Для **текущего календарного месяца** система показывает по каждому бюджету: потрачено (EUR), лимит (EUR), осталось (EUR), процент, статус **good / warn / over**.
- **G3**: Факт трат берётся из существующей canonical-агрегации — Σ `toEurAt(amount, currency, date)` по тратам месяца (date-aware, ADR-014), консистентно с donut на дашборде. Единый расчётный модуль переиспользуется и Admin-эндпоинтом, и bootstrap'ом Mini App.
- **G4**: Полный CRUD бюджетов — **только в Web Admin** (`/budgets`). Mini App при вводе траты показывает **read-only подсказку** «осталось X €» на плитке категории (owner-одобренное послабление правила 11; см. §3 NG / §7).
- **G5**: Пороги статусов (good/warn/over) — единственный источник на worker (используется Admin, Mini App, и в будущем cron-нудж 2.4). Клиент только красит.
- **G6**: Без избыточной загрузки: расчёт месяца — точечный date-фильтрованный запрос трат, **не** полная история (в духе пункта 1.8 — не плодить самоналожённые потери на чтении).

## 3. Non-Goals

- **NG1**: Не делаем мульти-валютные лимиты. Лимит всегда в EUR (решение Stepan'а 2026-05-31: 1:1 с EUR-аналитикой, без двойной конверсии).
- **NG2**: Не делаем историю лимитов по месяцам / per-month правки / «скопировать с прошлого месяца». Один recurring лимит на категорию. (Если понадобится — отдельная итерация, поле `period='YYYY-MM'`.)
- **NG3**: Не делаем rollover (перенос неизрасходованного остатка на следующий месяц). Жёсткий сброс на границе календарного месяца.
- **NG4**: Не делаем бюджеты на **доходные** категории. Только расходные (`categories.type='expense'`). Лимит на доход семантически не «сколько ещё можно потратить».
- **NG5**: Не делаем CRUD бюджетов в Mini App. Mini App — **только read-only подсказка** остатка при вводе. Создание/правка/удаление лимитов — Admin. (Правило 11 уточняется: Mini App = «ввод расходов + read-only бюджет-подсказка».)
- **NG6**: Не делаем push/нотификации при превышении (это AI-трек 2.4, отдельным проектированием). v1 — только визуальный статус в UI.
- **NG7**: Не навязываем согласованность «Σ категорийных лимитов = общий потолок» — это две независимые линзы (потолок может быть меньше суммы категорий).

## 4. User journeys

### Happy path (Admin)
1. Открываю **/budgets**. Вижу заголовок текущего месяца («Май 2026»), опциональную карточку общего потолка сверху, и список категорий с лимитами: эмодзи+цвет, прогресс-бар (зелёный/жёлтый/красный), «потрачено / лимит €», осталось, %.
2. Жму **«+ Бюджет»** → модал: выбираю категорию (только те, у кого ещё нет лимита) + ввожу лимит в EUR → сохраняю. Toast «Сохранено». Строка появляется с актуальным фактом за месяц.
3. Жму **«Общий потолок»** (если ещё не задан) → ввожу месячный лимит на все траты.
4. Кликаю строку бюджета → модал правки лимита или удаления (soft-delete = «перестать отслеживать»).
5. Категория, по которой в этом месяце есть траты, но нет лимита, видна в секции «Без лимита» с быстрым «+ Установить лимит».

### Happy path (Mini App)
6. Ввожу трату: на плитке категории, у которой задан бюджет, вижу компактную подсказку **«≈ X €»** остатка (зелёная) или **«−X €»** (красная, если уже превышено за месяц). Read-only — помогает решить, не открывая Admin.

### Edge cases
- **E1**: По категории нет лимита → в подсказке/списке прогресс не показывается (категория просто в «Без лимита» или без бейджа в Mini App).
- **E2**: Лимит задан, трат в этом месяце нет → spent=0, остаток=лимит, статус good (0%).
- **E3**: Превышение → остаток отрицательный, статус over, бар красный на 100% + подпись «−X € сверх лимита».
- **E4**: У траты нет курса на её дату (`toEurAt`=null, дата раньше backfill 2024-01-10) → трата пропускается в сумме, инкрементит `missing_rates` бюджета; в UI рядом со spent — маркер «≈/N без курса» (как на дашборде). Бюджет не обнуляется молча.
- **E5**: Категория с бюджетом деактивирована (`is_active=0`) → её бюджет не показывается в списке (JOIN по active-категориям), строка-сирота не висит. Бюджет-строка сохраняется (история), вернётся при реактивации категории.
- **E6**: Попытка создать второй активный бюджет на ту же категорию → 400 «бюджет для категории уже есть» (плюс защита unique-индексом). Аналогично второй общий потолок.
- **E7**: Граница месяца: 1-го числа все spent сбрасываются (новое окно `[YYYY-MM-01, конец месяца]`), лимиты те же (recurring).

## 5. Data model

Новая таблица. Миграция **`0011_budgets.sql`** (следующий номер; `schema.sql` обновляется параллельно — правило 2). Без изменений существующих таблиц.

```sql
-- 0011_budgets.sql — Фаза 2 пост-MVP (SPEC-020): бюджеты/лимиты по категориям
--
-- Добавляет:
--   - budgets: месячный лимит (EUR) на расходную категорию (scope='category')
--              или общий потолок на все траты (scope='total'). Recurring,
--              без истории по месяцам. Soft-delete.

CREATE TABLE IF NOT EXISTS budgets (
    id           TEXT PRIMARY KEY,                              -- UUID v4
    scope        TEXT NOT NULL DEFAULT 'category'
                   CHECK (scope IN ('category','total')),
    category_id  TEXT REFERENCES categories(id),               -- NOT NULL при scope='category', NULL при 'total'
    limit_eur    REAL NOT NULL CHECK (limit_eur > 0),          -- месячный лимит в EUR
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at   TEXT,                                          -- soft-delete (NULL = активен)
    CHECK (
        (scope = 'category' AND category_id IS NOT NULL) OR
        (scope = 'total'    AND category_id IS NULL)
    )
);

-- Один активный бюджет на категорию:
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_category
    ON budgets(category_id)
    WHERE deleted_at IS NULL AND category_id IS NOT NULL;

-- Максимум один активный общий потолок:
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_total
    ON budgets(scope)
    WHERE deleted_at IS NULL AND scope = 'total';
```

- **Факт трат не хранится** — вычисляется на лету (derived), никакой денормализации.
- Тип сумм — `REAL` (ADR-015), округление на выдаче (`r2`).
- FK на `categories(id)` без CASCADE (общая конвенция); деактивация категории не трогает строку бюджета.
- Idempotency создания — `INSERT OR IGNORE` по `id` (UUID), как везде.

## 6. API contract

Auth: JWT (Bearer) для всех `/v1/web/budgets/*`. Изменения bootstrap — additive.

### `GET /v1/web/budgets` (новый)
Возвращает бюджеты + факт за **текущий календарный месяц**.
```jsonc
{
  "ok": true,
  "month": "2026-05",                  // текущий календарный месяц (worker UTC)
  "currency": "EUR",
  "total": {                            // null, если общий потолок не задан
    "budget_id": "uuid",
    "limit_eur": 2000,
    "spent_eur": 1342.5,
    "remaining_eur": 657.5,
    "pct": 67,                          // round(spent/limit*100)
    "status": "good",                   // good | warn | over
    "missing_rates": 0
  },
  "categories": [                       // только бюджеты активных категорий, сорт по sort_order,name
    {
      "budget_id": "uuid",
      "category_id": "food",
      "name": "Еда",
      "emoji": "🍔",
      "color": "#ef4444",
      "limit_eur": 300,
      "spent_eur": 256.1,
      "remaining_eur": 43.9,
      "pct": 85,
      "status": "warn",
      "missing_rates": 0
    }
  ]
}
```
- `status` считается на worker по порогам §7 (единый источник, G5).
- Категории без бюджета **не** возвращаются (их полный список Admin берёт из `references`, чтобы предложить «+ установить лимит»).

### `POST /v1/web/budgets` (новый)
Body (Zod `budgetCreateSchema`): `{ id?: string, scope?: 'category'|'total', category_id?: string, limit_eur: number(>0) }`.
- `scope` default `'category'`. Бизнес-правила (домен, `Result`): при `scope='category'` — `category_id` обязателен, категория существует и `is_active=1` и `type='expense'`, нет активного бюджета на неё; при `scope='total'` — `category_id` отсутствует, нет активного потолка.
- 200 `{ ok:true, id, inserted }` | 400 `{ error }`.

### `PUT /v1/web/budgets/:id` (новый)
Body (Zod `budgetUpdateSchema`): `{ limit_eur: number(>0) }`. Меняется только лимит (scope/категория иммутабельны — чтобы сменить категорию: удалить + создать). 200 `{ ok:true }` | 404 | 400.

### `DELETE /v1/web/budgets/:id` (новый)
Soft-delete (`deleted_at = datetime('now')`). 200 `{ ok:true }`.

### `GET /v1/bootstrap` (изменено, additive)
В ответ добавляется `budgets` для read-only подсказки Mini App:
```jsonc
"budgets": {
  "month": "2026-05",
  "total": { "limit_eur": 2000, "spent_eur": 1342.5, "remaining_eur": 657.5, "status": "good" } | null,
  "categories": [
    { "category_id": "food", "limit_eur": 300, "spent_eur": 256.1, "remaining_eur": 43.9, "status": "warn" }
  ]
}
```
Тот же расчётный модуль, что и `/v1/web/budgets` (DRY). Auth — существующий initData (без новых проверок).

## 7. UI / UX

### Web Admin — новая страница `/budgets`
- Nav-пункт «Бюджеты» в `AppLayout` NAV (иконка lucide, напр. `Wallet`), маршрут в `routeTree` под `authedRoute`.
- **Заголовок**: название текущего месяца (напр. «Май 2026»). v1 — только текущий месяц, без PeriodPicker (лимиты recurring).
- **Карточка общего потолка** (если задан): крупный прогресс-бар good/warn/over + «Всего за месяц: spent / limit €, осталось X». Если не задан — кнопка «Задать общий потолок».
- **Список категорийных бюджетов**: строка = пилюля эмодзи+цвет (как в `CategoriesPage`), имя, прогресс-бар, «spent / limit €» + остаток + %. Hover-подсветка строки (memory `ui-hover-feedback`). Клик → модал правки/удаления.
- **Секция «Без лимита»**: активные расходные категории без бюджета (особенно с тратами в этом месяце) → «+ Установить лимит».
- **Модал** (общий `Modal`): выбор категории (`Select`, только небюджетированные) + поле лимита EUR; для правки — только лимит + кнопка «Удалить». Submit-состояние + `mutateAsync`; ошибки — авто-toast (`MutationCache.onError`), успех — `useToast` «Сохранено».
- **Состояния списка**: `isLoading` скелетон; `isError` → `ErrorState(onRetry)` (Фаза 1.2); пусто → «Бюджеты не заданы — установите лимит по категории».
- **Прогресс-бар (новый компонент `BudgetBar`)** — первый multi-threshold бар в коде. Геометрия как у Goals/CategoryBar (`h-2/h-3 rounded-full bg-secondary/60` + внутренний div), но цвет по статусу:
  - **good** `< 80%` → `#10b981` (зелёный)
  - **warn** `80–100%` → `#f59e0b` (амбер)
  - **over** `> 100%` → `#ef4444` (красный), ширина 100% + подпись «−X € сверх»
  - ширина = `min(100, pct)`, минимум 2% для видимости.
- Суммы — `formatAmount(x,'EUR')` (ru-RU, 2 знака), `<Currency code="EUR" />` где уместно.
- Инвалидация после мутаций: `['budgets']` **и** `['dashboard']` (бюджеты — линза на те же траты).

### Mini App — read-only подсказка остатка
- На плитке категории в сетке (numpad-экран ввода), если по категории есть бюджет: компактный бейдж остатка под именем — «≈ X €» (muted-green) или «−X €» (red) при over. Данные — из `bootstrap.budgets.categories`.
- Никакого ввода/правки лимитов. Scope Mini App не растёт за пределы read-only отображения (правило 11 уточнено).
- (Опционально, nice-to-have, не AC): при превышении остатка введённой суммой — подсветить total красным. Помечено как backlog, если усложнит.

## 8. Security

- Все `/v1/web/budgets/*` — за `requireAdminSession` (Bearer JWT, allowlist email). Два auth-канала не смешиваются (правило 4).
- Bootstrap (`budgets`) — за существующим initData HMAC; `limit_eur/spent_eur` — производные от уже доступных трат, новой PII нет.
- Валидация: Zod (shape) + доменные guard'ы (FK категории, `is_active`, `type='expense'`, scope-когерентность, уникальность). Ошибки → 400 с осмысленным текстом (`zodMessage`/`Result.error`), без stack-leak.
- Без новых secrets, без записи в логи. Все SQL параметризованы.

## 9. Acceptance criteria

- [ ] **AC1**: Миграция `0011_budgets.sql` создаёт `budgets` (scope/category_id/limit_eur/soft-delete + два partial unique-индекса); `schema.sql` обновлён параллельно; `gitleaks dir` clean; без правок применённых миграций.
- [ ] **AC2**: `POST /v1/web/budgets` создаёт категорийный бюджет; повторный POST на ту же активную категорию → 400; `scope='total'` создаёт общий потолок, второй потолок → 400.
- [ ] **AC3**: `GET /v1/web/budgets` возвращает по каждому бюджету `spent_eur` за **текущий календарный месяц** = Σ `toEurAt(amount,currency,date)` трат месяца этой категории (date-aware), `remaining_eur`, `pct`, `status` (good/warn/over по порогам §7). Для `total` — Σ всех трат месяца.
- [ ] **AC4**: Статусы корректны на границах: 79%→good, 80%→warn, 100%→warn, 101%→over. Считаются на worker (клиент не дублирует пороги).
- [ ] **AC5**: Трата без курса на дату (`toEurAt`=null) пропускается в сумме и инкрементит `missing_rates`; бюджет не падает в 0.
- [ ] **AC6**: `PUT /:id` меняет лимит (scope/категория неизменны); `DELETE /:id` soft-удаляет (исчезает из списка, unique-индекс освобождается → можно создать заново).
- [ ] **AC7**: Бюджет деактивированной категории не возвращается `GET /v1/web/budgets` (JOIN по `is_active=1`), строка-сирота в UI не висит.
- [ ] **AC8**: Web Admin `/budgets`: nav-пункт + страница; список с `BudgetBar` (good=зелёный/warn=амбер/over=красный); карточка общего потолка; «+ Бюджет»/«Без лимита»; `isLoading`/`isError(onRetry)`/empty; toast на мутациях; инвалидация `['budgets']`+`['dashboard']`.
- [ ] **AC9**: `GET /v1/bootstrap` отдаёт `budgets` (month/total/categories); Mini App показывает read-only бейдж остатка на плитке категории с бюджетом (зелёный/красный), без CRUD.
- [ ] **AC10**: Единый расчётный модуль (`budgets.ts` `computeBudgetProgress`) переиспользован и `/v1/web/budgets`, и bootstrap'ом (нет двух копий логики порогов/сумм).
- [ ] **AC11**: vitest покрывает `computeBudgetProgress`: окно месяца, EUR-сумма date-aware, missing-rate, пороги good/warn/over, общий потолок, пустой месяц.
- [ ] **AC12**: Правило 11 в `CLAUDE.md` уточнено («ввод + read-only бюджет-подсказка»); `roadmap`/`post-mvp-roadmap` отмечают 2.2 закрытым; вердикты Phase 3 в changelog SPEC.

## 10. Test plan

- **Worker (vitest, in-memory)**: `computeBudgetProgress(expenses, ratesIndex, month, budgets)` — границы месяца (`2026-04-30` исключён, `2026-05-01`/`-31` включены), date-aware EUR (RUB-трата 2024 по курсу 2024), missing-rate (дата < backfill), пороги 79/80/100/101%, общий потолок = Σ всех, пустой месяц = 0/good.
- **Worker (curl smoke)**: POST категорийный + total → GET (spent ≠ 0, status корректен) → PUT лимит → DELETE → повторный POST той же категории (ок после delete).
- **Admin SPA** (`local/scripts/test_admin_ui.py`, Playwright + mock JWT + mock `/v1/web/budgets`): `/budgets` — список, `BudgetBar` всех трёх статусов, карточка потолка, модал создания, empty/error состояния; скриншоты light/dark (memory `frontend-test-locally-before-deploy`).
- **Mini App** (`local/scripts/test_miniapp_react.py`, mock bootstrap с `budgets`): бейдж остатка на плитке категории (good/over), отсутствие бейджа у небюджетированной; light/dark.
- **Regression**: dashboard `expenses_by_category` без изменений; bootstrap не сломан для Mini App-ввода.

## 11. Risks & open questions

- **R1**: `spent` использует date-aware EUR (как donut). В пределах одного текущего месяца дрейф курса ≈ нулевой → консистентно с дашбордом. Документируем в doc-comment `budgets.ts`.
- **R2**: Bootstrap тяжелеет на месячный budget-расчёт при каждом открытии Mini App. Митигировано точечным date-фильтрованным запросом трат месяца (не вся история). Single-user — приемлемо.
- **R3** (scope/правило 11): подсказка в Mini App формально расширяет его за «только ввод». Решение owner'а (Stepan, 2026-05-31): read-only допустимо, CRUD остаётся в Admin. Правило 11 уточняется в `CLAUDE.md` (а не нарушается молча).
- **R4** (perf, backlog): месячная агрегация дублирует часть логики dashboard catTotals на другом окне. Возможный общий aggregator — отложено (как R2 SPEC-016), single-user не критично.
- **OQ1** (resolved): валюта лимита — EUR-only (Stepan 2026-05-31). Будущий мульти-валютный лимит — отдельная итерация (`currency_code` + конверсия лимит→EUR по today-курсу).
- **OQ2** (resolved): период — recurring месячный без истории (Stepan 2026-05-31). История лимитов — отдельная итерация при необходимости.
- **OQ3**: общий потолок и Σ категорийных лимитов независимы (NG7). Если на практике станет путать — добавить индикатор расхождения. Пересмотреть по использованию.

## 13. Changelog spec'а

- 2026-05-31: создан в `draft` после discovery-фан-аута (6 подсистем) + 4 product-развилок (валюта=EUR, период=recurring-месяц, охват=категории+потолок, место=Admin+Mini-App-подсказка).
- 2026-05-31: одобрен Stepan'ом, переведён в `in_progress`.
- 2026-05-31: реализовано (worker `budgets.ts` + миграция 0011 + Admin `/budgets` + Mini App hint), 9 vitest + 3 typecheck зелёные, визуально проверено (test_admin_ui light/dark/modal, test_miniapp_react good/warn/over). Phase 3: qa=PASS_WITH_NICES, arch=APPROVED_WITH_NICES, 0 must-fix. Nice-to-have'ы → roadmap tech-debt (двойной loadRatesIndex в bootstrap, pct-vs-status на границах, limit без верхнего cap). Полировка применена: aria-label строк, пред-выбор категории из «Без лимита». `done`.
