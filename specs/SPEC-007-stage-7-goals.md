---
id: SPEC-007
title: Stage 7 — Цели / целевые фонды (goals)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - adr: docs/decisions.md#adr-011
  - adr: docs/decisions.md#adr-012
  - adr: docs/decisions.md#adr-013
  - parent: docs/roadmap.md#этап-7--цели
  - depends_on: [SPEC-006]
---

# Stage 7 — Цели / целевые фонды (goals)

## 1. Context & Problem

После Stages 4–6 у нас есть учёт расходов, доходов и снапшотов балансов
по 7 вёдрам. Однако **деньги внутри одного ведра не разделены по смыслу**.
Конкретный кейс: «родители подарили 5000 EUR на стартовый депозит для
ипотеки → деньги физически лежат в EUR · банке, но я не должен
учитывать их в свободном бюджете на еду / траты». То же касается:

- накопления на переезд,
- финансовая подушка («не трогать 6 месячных расходов»),
- отложенные на отпуск или крупную покупку.

Без явного механизма «цели» эти суммы видны только через мысленное
вычитание из bucket-баланса. Сейчас Mini App / Web Admin не дают этого
из коробки — Net worth раздут, runway завышен, AI Coach (Stage 10) не
имеет хука для goal check-in'ов.

## 2. Goals

- G1: В D1 появилась таблица `goals` (name, target_amount?, target_currency?,
  deadline?, emoji, color, note, status: active/achieved/archived).
- G2: В D1 появилась таблица `goal_contributions` — ledger «вкладов»
  (ручной backfill, прикреплённые суммы); `amount > 0` в этой
  итерации.
- G3: `incomes` получает nullable FK `goal_id` — при вводе дохода можно
  его направить в конкретную цель.
- G4: Worker предоставляет CRUD `/v1/web/goals` и
  `/v1/web/goal-contributions` через Bearer JWT.
- G5: Web Admin: страница `/goals` — карточки целей с emoji, цветом,
  прогрессбаром, дедлайном и текущим балансом.
- G6: Goal detail (`/goals/:id`): таймлайн contributions (объединённый
  income+manual ledger), edit/delete, изменение статуса.
- G7: В IncomeModal — опциональный селект «Цель» (пустой = не привязан).
- G8: На `/accounts` — sub-summary «Целевые фонды: X EUR» под Net worth
  (Net worth теперь раскладывается на «Свободно / Целевые»).
- G9: Sidebar добавляет пункт «Цели».
- G10: Goal без `target_amount` — допустимая «копилка»; прогрессбар
  заменяется на текущий баланс.

## 3. Non-Goals

- NG1: **Negative contributions / withdraw из goal.** В этой итерации
  `amount > 0`. «Вынуть из goal» = поменять goal.status на
  `achieved` / `archived` (когда деньги ушли по назначению). Частичный
  withdrawal — отложен до Stage 7.5 (transactions).
- NG2: **Авто-распределение % от income.** «Каждый раз клади 10% от
  зарплаты в goal X» — это Stage 10 (AI Coach).
- NG3: **Sub-goals / иерархия.** Только плоский список.
- NG4: **Goal sharing с другими user'ами.** Single-user system.
- NG5: **Привязка snapshot'ов к goal.** Снапшот — это balance ведра
  (комбайн), у него нет «цели». Контрибуции идут только через incomes +
  manual ledger.
- NG6: **Expenses из goal.** Расход не уменьшает goal в этой итерации —
  это придёт когда появятся transactions (Stage 7.5) с goal_id.
- NG7: **Mini App.** ADR-012: scope Mini App = расходы + аналитика
  расходов. Goals — Web Admin only.
- NG8: **Графики/история goal progress over time.** Это Stage 8 Dashboard.
- NG9: **Notification / напоминания о deadline.** AI Coach (Stage 10).
- NG10: **Custom emoji picker компонент.** Сейчас `<input type="text">`
  + подсказка из 8–10 эмодзи.

## 4. User journeys

### Happy path — создать goal «Стартовый депозит»
1. Стёпа открывает `/goals`. Пусто — кнопка «+ Новая цель».
2. Жмёт. Открывается модал:
   - Имя: `Стартовый депозит на квартиру`
   - Эмодзи: `🏠`
   - Цвет: выбирает из палетки (8–10 hex).
   - Target amount: `5 000 000`, target currency: `RUB`
   - Deadline: `2027-06-01`
   - Заметка: «Цель — однушка в Белграде»
3. Сохраняет. Goal появляется в списке.
4. Текущий баланс = 0. Прогресс: `0%`.

### Happy path — backfill уже подаренной суммы
1. На карточке goal жмёт «+ Пополнить».
2. Модал «Новое пополнение»:
   - Дата: `2025-12-25`
   - Счёт (откуда): `RUB · банк`
   - Сумма: `2 000 000` `RUB`
   - Заметка: «От родителей на новый год»
3. Save. В `goal_contributions` создаётся row.
4. Прогресс обновляется: `40%` (2M / 5M).

### Happy path — привязать future income к goal
1. Стёпа получает следующую зарплату 100k RUB.
2. Открывает `/incomes`, «+ Новый доход».
3. В модале — новое поле «Цель» (опциональный select). Выбирает
   `🏠 Стартовый депозит`.
4. Save. Контрибуция attach автоматически через `incomes.goal_id`.
5. Goal balance = 2M + 100k = 2.1M, прогресс 42%.

### Happy path — goal достигнут
1. Стёпа фактически выложил депозит. Открывает goal detail.
2. Жмёт «Архивировать → Достигнута» (или «Сбросить → Архив»).
3. `goal.status = 'achieved'`. Goal больше не показывается на `/accounts`
   как часть «Целевых фондов», но остаётся видимой на `/goals` (фильтр
   «достигнуты / архив»).

### Edge cases
- E1: **Goal без target_amount** — прогрессбар не показывается; вместо
  него — текущий баланс крупно.
- E2: **Goal с прошедшим deadline** — индикатор «просрочено»
  (красный), но goal остаётся active.
- E3: **Income привязан к удалённому goal'у** — после `DELETE goal`
  Worker ставит `incomes.goal_id = NULL` (мягкая каскадная очистка),
  `goal_contributions.deleted_at = now`.
- E4: **Currency mismatch** — income в EUR привязан к goal с
  target_currency=RUB. Контрибуция считается «как есть в EUR»; в
  таймлайне отображается оригинальная сумма + конвертация в goal
  currency (по курсу даты).
- E5: **Target_amount = 0** — невалидно; backend 400 «target_amount > 0
  или null».
- E6: **Deadline в прошлом при создании** — разрешено (для overdue или
  retroactive goal'ов), но UI показывает warning.
- E7: **Goal с пустым name** — 400.
- E8: **Курс отсутствует для contribution currency** — отображаем
  оригинальную сумму; в goal balance — `?` для отсутствующих, индикатор
  «N контрибуций без курса».

## 5. Data model

### Миграция 0008 (D1)

```sql
-- cloud/worker/migrations/0008_goals.sql

-- ─── Цели ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
    id              TEXT PRIMARY KEY,             -- UUID v4
    name            TEXT NOT NULL,
    emoji           TEXT,                          -- одиночный emoji или 1-2 символа
    color           TEXT,                          -- #RRGGBB
    target_amount   REAL CHECK (target_amount IS NULL OR target_amount > 0),
    target_currency TEXT REFERENCES currencies(code),
    deadline        TEXT,                          -- YYYY-MM-DD, nullable
    note            TEXT,
    status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'achieved' | 'archived'
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_goals_status      ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_active      ON goals(status, sort_order) WHERE deleted_at IS NULL;

-- ─── Ручные контрибуции в goal ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goal_contributions (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT NOT NULL REFERENCES goals(id),
    date            TEXT NOT NULL,                          -- YYYY-MM-DD
    amount          REAL NOT NULL CHECK (amount > 0),
    currency_code   TEXT NOT NULL REFERENCES currencies(code),
    account_id      TEXT REFERENCES accounts(id),           -- optional: «из какого ведра»
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_goal_contribs_goal   ON goal_contributions(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_date   ON goal_contributions(date);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_active ON goal_contributions(goal_id, date)
    WHERE deleted_at IS NULL;

-- ─── Связь incomes ↔ goal ─────────────────────────────────────────────────
ALTER TABLE incomes ADD COLUMN goal_id TEXT REFERENCES goals(id);
CREATE INDEX IF NOT EXISTS idx_incomes_goal ON incomes(goal_id);
```

### Семантика полей и инвариантов

- **`goals.status`** — `active` (видна в списках, входит в Net worth
  целевых), `achieved` (цель достигнута, остаётся в истории), `archived`
  (отменена; не входит в агрегации, не показывается по умолчанию).
- **`goals.target_amount`** — nullable: goal без target = «копилка»
  без прогрессбара. Если задано → должно быть > 0.
- **`goals.target_currency`** — обязательно если `target_amount` задано;
  иначе nullable. Конкретная валюта (RUB, EUR, USDT…).
- **`goal_contributions`** — отдельный ledger, **не** дублирует
  incomes. Сюда попадают:
  - retroactive backfill (родители подарили год назад),
  - ручные пополнения без income (например, перекинул из ведра в ведро
    через банк — это не income, но фактически положил в goal),
  - корректировки.
- **`incomes.goal_id`** — nullable FK. Если задан, income считается
  contribution в goal (без копирования в goal_contributions).
- **goal balance** = SUM(incomes WHERE goal_id=X AND deleted_at IS NULL,
  converted to goal.target_currency)
  + SUM(goal_contributions WHERE goal_id=X AND deleted_at IS NULL,
  converted to goal.target_currency).
- **goal progress** = balance / target_amount × 100% (если target есть).
- **Soft delete goal** → `incomes.goal_id` → NULL,
  `goal_contributions.deleted_at` = `datetime('now')`.

### Что НЕ менялось

- `snapshots`, `accounts`, `categories`, `currencies`, `rates`, `expenses`,
  `authorized_users`, `income_categories` — без изменений.

## 6. API contract

Все эндпоинты под `/v1/web/*` требуют **Bearer JWT** (`requireAdminSession`).

### `GET /v1/web/goals`
Список целей с computed balance и progress.

- Query:
  - `status` (active|achieved|archived; default = active).
- Response 200:
  ```json
  {
    "goals": [
      {
        "id": "uuid",
        "name": "Стартовый депозит",
        "emoji": "🏠",
        "color": "#a78bfa",
        "target_amount": 5000000,
        "target_currency": "RUB",
        "deadline": "2027-06-01",
        "note": "...",
        "status": "active",
        "sort_order": 10,
        "balance": 2100000,           // в target_currency, по последним курсам
        "balance_missing_rates": 0,   // сколько contributions без курса
        "contribution_count": 3,
        "created_at": "..."
      }
    ]
  }
  ```

### `GET /v1/web/goals/:id`
Detail + объединённый список contributions (incomes + manual).

- Response 200:
  ```json
  {
    "goal": { ...same as list... },
    "contributions": [
      {
        "id": "uuid",
        "source": "income" | "manual",
        "date": "...",
        "amount": ...,
        "currency_code": "...",
        "account_id": "...",
        "note": "...",
        "income_id": "..." // если source=income
      }
    ]
  }
  ```
  Сортировка: `date DESC, created_at DESC`.

### `POST /v1/web/goals`
Создание goal. Идемпотентно по `id`.

- Body:
  ```json
  {
    "id": "uuid-v4",                   // optional
    "name": "...",
    "emoji": "🏠",
    "color": "#a78bfa",
    "target_amount": 5000000,           // optional
    "target_currency": "RUB",           // обязательно если target_amount задан
    "deadline": "2027-06-01",           // optional
    "note": "..."                       // optional
  }
  ```
- Response 200: `{ "ok": true, "id": "uuid", "inserted": true|false }`
- Response 400: `{ "error": "name is required" }` / `{ "error": "target_amount must be positive" }`
  / `{ "error": "target_currency required when target_amount is set" }`
  / `{ "error": "unknown target_currency" }`.

### `PUT /v1/web/goals/:id`
- Body: любое подмножество полей outside `id`/`status`.
- Response 200: `{ "ok": true, "updated": true|false }`.

### `POST /v1/web/goals/:id/status`
Отдельный endpoint для смены статуса (defence-in-depth: статус не
меняется через обычный PUT, чтобы не было accident'а).

- Body: `{ "status": "active" | "achieved" | "archived" }`.
- Response 200: `{ "ok": true }`.

### `DELETE /v1/web/goals/:id`
Soft delete + cascading detach:
- `goals.deleted_at = datetime('now')`.
- `UPDATE incomes SET goal_id = NULL WHERE goal_id = :id`.
- `UPDATE goal_contributions SET deleted_at = datetime('now') WHERE goal_id = :id`.
- Response 200: `{ "ok": true, "detached_incomes": N, "deleted_contributions": M }`.

### `POST /v1/web/goal-contributions`
Создание ручной contribution.

- Body:
  ```json
  {
    "id": "uuid",                       // optional
    "goal_id": "uuid",
    "date": "2025-12-25",
    "amount": 2000000,                  // > 0
    "currency_code": "RUB",
    "account_id": "rub-bank",           // optional
    "note": "..."                       // optional
  }
  ```
- Response 200: `{ "ok": true, "id": "...", "inserted": true|false }`.
- Response 400: same shape как у incomes (unknown goal_id /
  unknown currency / unknown account / amount must be positive).

### `PUT /v1/web/goal-contributions/:id`
- Partial update.

### `DELETE /v1/web/goal-contributions/:id`
- Soft delete.

### Изменения в `incomes` endpoints

- `POST /v1/web/incomes` принимает поле `goal_id` (optional).
- `PUT /v1/web/incomes/:id` поддерживает `goal_id` (можно установить
  или сбросить в null).
- `GET /v1/web/incomes` возвращает `goal_id` (новое поле).

## 7. UI / UX

### Маршрут `/goals`

```
┌─────────────────────────────────────────────────────────────────────┐
│ Цели                                            [+ Новая цель]      │
│ Деньги, отложенные на конкретное намерение.                         │
├─────────────────────────────────────────────────────────────────────┤
│ Активные · Достигнутые · Архив                                      │
├──────────────────────┬──────────────────────┬───────────────────────┤
│ 🏠 Стартовый депозит │ ✈️ Отпуск 2026       │ 🛡 Подушка            │
│ ███████████░░░░ 42% │ ████░░░░░░░░░░ 25%  │ ██████████████░ 92%   │
│ 2.1M / 5M RUB       │ 1 250 / 5 000 EUR   │ 11 500 / 12 500 EUR   │
│ до 01.06.2027       │ до 15.09.2026       │ без срока             │
└──────────────────────┴──────────────────────┴───────────────────────┘
```

#### Карточка goal
- Иконка (`goal.emoji` или `Target` lucide дефолт) на фоне `color + "22"`.
- Имя + (опциональный) badge статуса (`achieved` / `archived`).
- Если есть `target_amount`:
  - Прогрессбар (height 8px, rounded-full, fill = color).
  - Подпись: `{balance} / {target} {currency}` + percentage.
- Если нет target:
  - Просто `{balance} {currency}` крупно.
- Если есть `deadline`:
  - `до DD.MM.YYYY` (приглушённо).
  - Overdue (deadline < today) — красная подпись.
- Click on card → `/goals/:id`.

#### Tabs «Активные / Достигнутые / Архив»
- Segmented control (того же стиля что PeriodPicker).
- По умолчанию — Активные.

### Маршрут `/goals/:id` (goal detail)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Цели       🏠 Стартовый депозит              [✎] [···] [🗑]       │
├─────────────────────────────────────────────────────────────────────┤
│ 2 100 000.00 / 5 000 000.00 RUB · 42%                               │
│ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │
│ Дедлайн: 01.06.2027 · 13 месяцев осталось                           │
│ «Цель — однушка в Белграде»                                         │
├─────────────────────────────────────────────────────────────────────┤
│ История пополнений                              [+ Пополнить]       │
│ ┌──────┬──────────┬─────────────┬─────────┬───────────┬───────┐    │
│ │ Дата │ Источник │   Сумма     │ Счёт    │ Заметка   │  ✎ 🗑  │   │
│ ├──────┼──────────┼─────────────┼─────────┼───────────┼───────┤    │
│ │14.05 │Зарплата  │ 100 000 RUB │ RUB·банк│ Из мая 1-й│       │    │
│ │      │(income)  │             │         │           │       │    │
│ │25.12 │Manual    │ 2 000 000 RUB│RUB·банк│От родителей│ ✎ 🗑 │    │
│ │24-01-15│Зарплата │ 1 000 EUR  │EUR·банк │ ≈92k RUB  │       │    │
│ └──────┴──────────┴─────────────┴─────────┴───────────┴───────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Header**: emoji + name + edit (open modal) + меню (статус) + delete.
- **Progress block**: balance/target большим шрифтом, прогрессбар,
  deadline + countdown.
- **«[···] меню»**: «Отметить достигнутой», «Архивировать», «Снова
  active».
- **Таблица contributions**: source = `income` (с link на `/incomes`)
  или `manual`. Edit/delete только для manual.
- **`+ Пополнить`** → модал создания manual contribution.

### Modal: создание/редактирование goal

```
┌─────────────────────────────────────────┐
│ Новая цель                          ✕   │
├─────────────────────────────────────────┤
│ Название                                │
│ [Стартовый депозит на квартиру       ]  │
│                                         │
│ Эмодзи (опц.)                           │
│ [🏠] · 🏠 ✈️ 🛡 💍 🚗 🎓 🏖 🏥 (быстрый выбор)│
│                                         │
│ Цвет                                    │
│ [● ● ● ● ● ● ● ●]   (8 цветов палетка) │
│                                         │
│ Цель (опц.)              Валюта         │
│ [5000000          ]  [RUB ▼]            │
│                                         │
│ Дедлайн (опц.)                          │
│ [2027-06-01         ]                   │
│                                         │
│ Заметка (опц.)                          │
│ [Цель — однушка в Белграде          ]   │
│                                         │
│         [Отмена]  [Создать]             │
└─────────────────────────────────────────┘
```

- Все поля кроме `name` опциональны.
- Эмодзи: `<input>` + 8 подсказок (click → set). Custom emoji picker —
  backlog.
- Цвет: 8 hex колбэков из единой палетки (см. `accounts.color` —
  same set + добавим pastel).

### Modal: создание manual contribution

```
┌─────────────────────────────────────────┐
│ Пополнить «Стартовый депозит»       ✕  │
├─────────────────────────────────────────┤
│ Дата                                    │
│ [2026-05-25                          ▼] │
│                                         │
│ Сумма                       Валюта      │
│ [2000000           ]    [🇷🇺 RUB ▼]    │
│                                         │
│ Из ведра (опц.)                         │
│ [— не указано — / 🇷🇺 RUB · банк ▼]    │
│                                         │
│ Заметка (опц.)                          │
│ [От родителей на новый год           ]  │
│                                         │
│         [Отмена]  [Сохранить]           │
└─────────────────────────────────────────┘
```

- При open: default `currency_code` = `goal.target_currency` (если есть),
  иначе первая active валюта.
- `account_id` пустое = «не указано» (контрибуция не привязана к ведру).

### Изменения в IncomeModal

Добавляется новое поле под «Категория»:

```
Цель (опц.)
[— не привязано — ▼]
  🏠 Стартовый депозит
  ✈️ Отпуск 2026
  🛡 Подушка
```

При сохранении income — `goal_id` уходит в Worker.

### Изменения на `/accounts`

Под Net worth — новый блок:

```
┌─────────────────────────────┐
│ Net worth (EUR-эквив.)      │
│ 12 543.21 EUR               │
│ ┌─ Свободно:  8 200.00 EUR  │
│ └─ Целевые:   4 343.21 EUR  │
│                             │
│ Активных целей: 3           │
└─────────────────────────────┘
```

- `Целевые` = SUM(goal.balance converted to EUR) WHERE status='active'.
- `Свободно` = Net worth − Целевые.

### Sidebar

- Был: пустой слот «Цели» (currently не существует в NAV).
- Добавляется новый пункт: `{ to: "/goals", icon: Target, label: "Цели" }`.
- Стоит между «Доходы» и «Обмены» (disabled).

## 8. Security

- **Auth.** Все endpoints под `requireAdminSession`. Mini App никак не
  доступа к goals (она ничего не знает о них).
- **Input validation.**
  - `name`: обязательно, non-empty trim.
  - `target_amount`: optional, если задан — `typeof === 'number'` && `> 0`.
  - `target_currency`: обязательно если `target_amount` задан, FK
    проверка в Worker.
  - `deadline`: optional, YYYY-MM-DD format (UI ставит `type="date"`).
  - `emoji`: free text, max 8 символов (UI лимит).
  - `color`: free text, валидация формата `#RRGGBB` через regex в Worker
    (defence-in-depth; SQL не лимитирует).
  - `note`: free text, maxLength 500 на UI.
  - `status` (PATCH/POST status): enum `active|achieved|archived`.
  - `goal_contributions.amount`: `> 0`.
  - `goal_contributions.currency_code`: FK check.
  - `goal_contributions.account_id`: optional FK.
  - `incomes.goal_id`: optional FK (валидируется как `unknown goal_id`).
- **PII в логах**: суммы / note / emoji не логируем.
- **CORS**: через shared `cors.ts`.
- **Cascade rules**:
  - DELETE goal → set `incomes.goal_id = NULL` + soft-delete
    contributions. Транзакция через `env.DB.batch`.
  - DELETE contribution → soft only.

## 9. Acceptance criteria

- [ ] AC1: Миграция 0008 применима к remote D1; после неё:
  - `SELECT COUNT(*) FROM goals` = 0.
  - `SELECT COUNT(*) FROM goal_contributions` = 0.
  - `PRAGMA table_info(incomes)` содержит колонку `goal_id`.
- [ ] AC2: `GET /v1/web/goals` пустой массив (Bearer ok).
- [ ] AC3: `POST /v1/web/goals` с `{name, target_amount, target_currency,
  deadline, emoji, color, note}` создаёт row; `inserted=true`.
- [ ] AC4: `POST /v1/web/goals` без `name` → 400.
- [ ] AC5: `POST` с `target_amount=0` или отрицательным → 400.
- [ ] AC6: `POST` с `target_amount` без `target_currency` → 400.
- [ ] AC7: `POST` с unknown `target_currency` → 400.
- [ ] AC8: `GET /v1/web/goals` возвращает `balance = 0`,
  `contribution_count = 0` для новой goal без contributions.
- [ ] AC9: `POST /v1/web/goal-contributions` создаёт row; goal balance
  пересчитан.
- [ ] AC10: `POST /v1/web/incomes` с `goal_id` создаёт income; goal
  balance включает amount этого income.
- [ ] AC11: `POST /v1/web/incomes` с unknown `goal_id` → 400.
- [ ] AC12: `PUT /v1/web/incomes/:id` может установить или сбросить
  `goal_id` (с фолбэком на existing значение если поле не передано).
- [ ] AC13: `POST /v1/web/goals/:id/status` меняет status; balance в
  `GET /v1/web/goals?status=active` исключает archived/achieved.
- [ ] AC14: `DELETE /v1/web/goals/:id` soft-deletes goal, обнуляет
  `incomes.goal_id` (видно через `GET /v1/web/incomes`), мягко удаляет
  все contributions этого goal'а.
- [ ] AC15: На `/goals` отображаются только active goals по умолчанию.
- [ ] AC16: Карточка goal без `target_amount` показывает только баланс,
  без прогрессбара.
- [ ] AC17: Карточка goal с deadline < today — красный индикатор
  «просрочено».
- [ ] AC18: На `/accounts` блок Net worth раскладывается:
  Свободно + Целевые. Сумма совпадает с Total.
- [ ] AC19: В IncomeModal поле «Цель» загружается из
  `GET /v1/web/goals?status=active` (через TanStack Query cache).
- [ ] AC20: Регрессии Stage 6: `/incomes` без `goal_id` работает как раньше.
- [ ] AC21: Регрессии Stage 5a / 4: `/accounts`, `/snapshots`,
  `/expenses`, `/dashboard` — без изменений.

## 10. Test plan

### Worker (curl smoke)
- `GET /v1/web/goals` пустой → empty array
- `POST /v1/web/goals` happy → 200
- Все 400 кейсы (AC4-AC7, AC11)
- `POST /v1/web/goal-contributions` + `GET /v1/web/goals` — balance
  пересчитан
- `POST /v1/web/incomes` с goal_id + `GET /v1/web/goals/:id` —
  contribution через income в списке
- `DELETE /v1/web/goals/:id` + `GET /v1/web/incomes` — `goal_id=null`

### D1
- `wrangler d1 execute --remote` для всех 3 таблиц:
  - PRAGMA table_info на `incomes` (есть `goal_id`)
  - SELECT после контрибуций — balance correct

### Admin SPA (Playwright)
- Login + auth mock
- `/goals` пустой → empty state
- Create goal с emoji + color + target + deadline
- Backfill manual contribution
- В IncomeModal выбор goal
- Goal detail page — таймлайн contributions (mixed sources)
- Change status → goal перешёл в «Достигнуты» tab
- Delete goal с подтверждением → goal исчезла, income.goal_id очистился
- На `/accounts` — Net worth split

### Mini App regression
- Запустить трату с iPhone → доезжает (никаких изменений).
- `test_ui.py` Playwright — без падений.

### Не делается в этой итерации
- Unit-тесты Worker'а (ручной curl)
- Снапшоты balance over time для goal (Stage 8).

## 11. Risks & open questions

- R1: **Currency drift в goal balance.** Если все contributions в
  одной валюте — балланс детерминирован. Если разные валюты —
  конвертация по текущему курсу → balance может «дрейфовать» при
  обновлении rates. Mitigation: показываем `balance_missing_rates`
  counter, при `?` UI отображает примерное значение со звёздочкой.
- R2: **Net worth split (Свободно / Целевые) — это approximation.**
  Goal balance physically лежит в каком-то ведре, но в каком — мы не
  знаем (контрибуции могут указывать `account_id`, но это not enforced).
  Поэтому «Свободно» = Total − Целевые работает только в среднем,
  не per-bucket. Для MVP достаточно; granular split — Stage 8.
- R3: **Goal без target_currency но с балансом из contributions в
  разных валютах** — баланс не агрегируется. Сейчас мы делаем
  target_currency required если есть target_amount, но если goal без
  target — баланс отображается «по валютам» (несколько строк). Это
  спорно — лучше всегда требовать target_currency на goal, даже без
  target_amount. Решаем: **target_currency = required** при создании.
  Goal без target_amount имеет currency, просто без цели по сумме.
- R4: **Cascade при delete goal** — atomic batch. Если batch упадёт
  частично — partial state. Митigation: D1 batch гарантирует атомарность
  (Cloudflare docs).
- R5: **Income с goal_id и тут же income.amount=0** — не возможно
  благодаря CHECK на incomes.amount > 0 (Stage 6).
- OQ1: **Edit income с goal_id — нужно ли пересчитывать goal balance в
  Worker сразу или это lazy?** Решение: balance computed on-the-fly в
  `GET /v1/web/goals` query (не cache). SQL: SUM с CASE + JOIN. Это
  read-heavy но writes простые.
- OQ2: **Что если у goal target=5000000 RUB, а balance уже 6000000?**
  Прогресс > 100%. UI клиппим bar к 100%, показываем `120%` подпись.
  Это нормально — overachieved.

## 12. Out of scope для review

- Графики прогресса goal over time (Stage 8).
- Notifications о deadline (Stage 10).
- Auto-allocation % from each income (Stage 10).
- Sub-goals / hierarchy.
- Withdraw goal в expenses (Stage 7.5/8).
- Sharing goals с другими users.
- Mini App не получает goals API.

## 13. Changelog spec'а

- 2026-05-25: создан в `draft`. Discovery answers: name+target+deadline+emoji+color+note;
  goal currency native; contributions = incomes + manual ledger;
  roadmap slot Stage 7.
- 2026-05-25: статус `in_progress` (старт Phase 2).
- 2026-05-25: Phase 2 — миграция 0008 + Worker `v 03fc327a` + Admin SPA задеплоены.
- 2026-05-25: Phase 3 audit. QA PASS_WITH_SHOULDS (10 should-fix, 0 must),
  Arch APPROVED_WITH_SHOULDS (5 should, 0 must). Применены 9 фиксов одним
  follow-up commit'ом: cache invalidation goals при incomes mutation
  (data-integrity, AC10), TS contract IncomeCreatePayload.goal_id,
  GoalSelector использует `all` чтобы не «терять» achieved/archived,
  handleWebIncomesList парсит ?goal_id, listGoals валидирует status enum,
  updateGoal trim'ает name, useMemo→useEffect re-init,
  Edit Goal modal в GoalDetailPage, menu close on outside click + Escape.
  Edit Contribution UI / isError page state / Net worth currency-aware
  split — перенесены в `docs/roadmap.md` tech-debt. См.
  `specs/audits/SPEC-007-{qa,arch}.md`.
- 2026-05-25: статус `done`. Roadmap обновлён.
