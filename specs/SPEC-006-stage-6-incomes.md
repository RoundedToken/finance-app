---
id: SPEC-006
title: Stage 6 — Доходы (Web Admin): CRUD + категории + базовая аналитика
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - revised_by: [SPEC-025, SPEC-032, SPEC-042]  # конверсия goal-дохода; OQ1 закрыт
  - adr: docs/decisions.md#adr-011
  - adr: docs/decisions.md#adr-012
  - adr: docs/decisions.md#adr-013
  - parent: docs/roadmap.md#этап-6--доходы-web-admin
  - depends_on: [SPEC-004, SPEC-005]
---

# Stage 6 — Доходы (Web Admin): CRUD + категории + базовая аналитика

## 1. Context & Problem

После Stages 4–5a у нас есть Web Admin с авторизацией Google OAuth и
страницы `/expenses` (read-only) + `/snapshots` (CRUD по балансам 7 вёдер).
Однако **в D1 нет ни одного дохода** — ни зарплат, ни процентов, ни
разовых поступлений. Без них:
- Невозможно посчитать `savings rate`, `monthly income`, `runway`
  (Stage 8 Dashboard будет полупустой).
- Снапшоты счетов формально не привязаны к причинам пополнения — видно
  «сумма выросла на 1000 EUR», но непонятно, что это (зарплата? обмен?).
- AI Coach (Stage 10) не сможет рассуждать о доходах вообще.

Stage 6 добавляет минимально-достаточную модель доходов и UI для их
ведения. **Снапшоты остаются отдельной сущностью** (без auto-INSERT при
добавлении дохода — пользователь сам решает, когда фиксировать остаток).

## 2. Goals

- G1: В D1 появилась таблица `incomes` (UUID + date + account_id + amount
  + currency + category_id + source + note + created_at + updated_at +
  deleted_at) и справочник `income_categories` с 6 базовыми категориями.
- G2: Worker предоставляет CRUD через Bearer JWT:
  `GET/POST/PUT/DELETE /v1/web/incomes` + `GET /v1/web/income-categories`.
- G3: Web Admin SPA — страница `/incomes`:
  - 3 KPI-карточки сверху (этот месяц / последние 12 месяцев / всё время,
    суммы в EUR-эквиваленте).
  - Breakdown by category (горизонтальные бары: «Зарплата 80 % · 4 200 EUR»).
  - Таблица с поиском, фильтром по категории, фильтром по периоду.
  - Модальное окно create/edit с полями: дата, ведро, категория, сумма,
    источник, заметка.
  - Кнопка «Скопировать из последнего» — pre-fill полей по самому
    свежему доходу выбранной категории.
- G4: Sidebar добавляет пункт «Доходы» (раньше был `disabled`).
- G5: 6 базовых категорий доходов: `Зарплата`, `Проценты`, `Подарки`,
  `Выигрыши / Cashback / возвраты`, `Freelance`, `Прочее`.
- G6: Идемпотентность POST: повторный вызов с тем же `id` →
  `inserted=false`, без дубликата (как у `/v1/expenses`).

## 3. Non-Goals

- NG1: **Авто-snapshot при доходе.** Не делаем (см. ответ Discovery №3).
  Доход и снапшот — независимые сущности. Возможна client-side подсказка,
  но без авто-INSERT.
- NG2: **Recurring schedule / шаблоны зарплаты.** Никаких cron-job'ов,
  никакой таблицы `recurring_incomes`. Только client-side кнопка
  «Скопировать из последнего».
- NG3: **Split на несколько вёдер.** Один доход = один bucket. Если
  зарплата приходит в два счёта — две отдельных записи `income`.
- NG4: **Унификация с `transactions`.** Stage 7 (обмены) получит свою
  таблицу `transactions`, но миграцию `incomes → transactions` сейчас
  не делаем.
- NG5: **CRUD категорий через UI.** В этой итерации категории
  фиксированы (миграция). UI для добавления категорий — backlog (можно
  через `wrangler d1 execute INSERT`).
- NG6: **Доходы в Mini App.** Mini App scope зафиксирован (см. ADR-012,
  CLAUDE.md rule 11). `/v1/incomes` (без `/web/`) **не существует**.
- NG7: **Расширение Dashboard.** KPI и breakdown — только на странице
  `/incomes`. Глобальный дашборд — Stage 8.
- NG8: **Графики time series доходов.** Bar chart по месяцам — backlog
  Stage 8.

## 4. User journeys

### Happy path — первая зарплата
1. Стёпа открывает `https://finances-admin.pages.dev`, логинится через
   Google.
2. В sidebar кликает «Доходы». Открывается `/incomes`.
3. KPI: «Этот месяц — 0 EUR», «12 мес — 0 EUR», «Всего — 0 EUR».
   Таблица: «Доходов пока нет. Заведи первый — кнопкой выше.»
4. Жмёт «+ Новый доход». Открывается модал.
5. Заполняет: Дата = сегодня (default), Ведро = `RUB · банк`, Категория =
   `Зарплата`, Сумма = `100000`, Источник = `Anthropic` (опционально),
   Заметка = «За первую половину мая» (опционально).
6. Жмёт «Создать». Модал закрывается, таблица обновляется (queries
   invalidated). KPI пересчитываются.

### Happy path — копирование зарплаты
1. Через 2 недели Стёпа снова открывает `/incomes`.
2. Жмёт «+ Новый доход». В модале выбирает категорию `Зарплата`.
3. Над полями появляется кнопка `⎘ Из последней «Зарплата Anthropic»`.
4. Жмёт. Модал заполняется: bucket / amount / source — как у предыдущей
   зарплаты. Дата = сегодня. Заметку — обнуляем (она бывает разной).
5. Меняет сумму если надо, жмёт «Создать».

### Happy path — корректировка
1. Стёпа понял, что в доходе опечатка. Открывает `/incomes`, ищет
   запись (поиск по source / note / amount / category).
2. Жмёт «Карандаш». Модал открывается с заполненными полями.
3. Меняет сумму. Жмёт «Сохранить». Таблица + KPI обновляются.

### Happy path — удаление
1. Стёпа жмёт «Корзина» у строки.
2. `window.confirm()`: «Удалить доход? Зарплата · 100 000 RUB ·
   24.05.2026». Подтверждает.
3. Soft-delete (`deleted_at = datetime('now')`). Строка исчезает из
   таблицы и из KPI.

### Edge cases
- E1: **Пустой стейт** — empty state с подсказкой «Заведи первый доход».
- E2: **JWT истёк (401)** — `apiFetch` чистит localStorage, редиректит
  на `/login`. Унаследовано из Stage 4.
- E3: **POST без обязательного поля** — Worker возвращает 400
  `{"error": "date, account_id, amount, category_id are required"}`.
- E4: **Сумма ≤ 0** — на frontend кнопка Submit `disabled`. На backend —
  отдельно валидируем `amount > 0` (доход 0 не имеет смысла; для возврата
  средств — отдельная категория `Выигрыши / Cashback / возвраты`).
- E5: **Курсы не подгрузились** — KPI и breakdown в EUR показывают `—`
  и подпись «курсы не загружены»; native-валюты доходов на странице
  всё равно видны корректно.
- E6: **`category_id` несуществующий** — фронт всегда выбирает из
  существующих (`<select>`); backend ловит FK violation. Возвращаем 400.
- E7: **DELETE уже удалённого** — `changes=0`, `deleted=false`; SPA
  invalidate-ит queries, таблица «самовосстанавливается».
- E8: **Доход в валюте, для которой нет курса** (например, забыли
  свежий TRY→EUR) — KPI пропускает запись + tooltip «N доходов без курса».

## 5. Data model

### Миграция 0007 (D1)

```sql
-- cloud/worker/migrations/0007_incomes.sql

-- 1) Справочник категорий доходов
CREATE TABLE IF NOT EXISTS income_categories (
    id          TEXT PRIMARY KEY,                  -- стабильный slug
    name        TEXT NOT NULL,
    emoji       TEXT,
    color       TEXT,                              -- hex, #RRGGBB
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO income_categories (id, name, emoji, color, sort_order) VALUES
    ('salary',    'Зарплата',                       '💼', '#a78bfa', 10),
    ('interest',  'Проценты',                       '📈', '#34d399', 20),
    ('gifts',     'Подарки',                        '🎁', '#f9a8d4', 30),
    ('cashback',  'Выигрыши / Cashback / возвраты', '🎟️', '#fbbf24', 40),
    ('freelance', 'Freelance',                      '💻', '#22d3ee', 50),
    ('other',     'Прочее',                         '✨', '#94a3b8', 60);

-- 2) Доходы
CREATE TABLE IF NOT EXISTS incomes (
    id            TEXT PRIMARY KEY,                            -- UUID v4 (ADR-005)
    date          TEXT NOT NULL,                                -- YYYY-MM-DD
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    amount        REAL NOT NULL CHECK (amount > 0),             -- native currency аккаунта
    currency_code TEXT NOT NULL REFERENCES currencies(code),    -- денормализация для скорости агрегатов
    category_id   TEXT NOT NULL REFERENCES income_categories(id),
    source        TEXT,                                          -- «Anthropic», «Родители» (free text)
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_incomes_date         ON incomes(date);
CREATE INDEX IF NOT EXISTS idx_incomes_account_date ON incomes(account_id, date);
CREATE INDEX IF NOT EXISTS idx_incomes_category     ON incomes(category_id);
CREATE INDEX IF NOT EXISTS idx_incomes_active_date  ON incomes(date) WHERE deleted_at IS NULL;
```

### Семантика полей

- `incomes.amount` — **в native currency аккаунта**. Никаких конверсий
  на write. EUR-эквивалент считается на read во фронте через `refs.rates`.
- `incomes.currency_code` — **денормализация** из `accounts.currency`
  для скорости агрегатов (KPI / breakdown). На POST/PUT Worker сам
  подставляет правильную валюту из `accounts.currency` по `account_id` —
  клиент не должен её присылать. Если клиент прислал — игнорируем.
- `incomes.source` — свободный текст («от кого пришло»). Опциональный.
  В будущем может стать справочником, но сейчас не нужно (low cardinality
  для одного пользователя, free text проще).
- `incomes.note` — описательная заметка, опционально. Свободный текст.
- `incomes.category_id` — обязательный FK. Категорию `other` НЕЛЬЗЯ
  считать «дефолтом» — клиент должен явно выбрать.
- `income_categories.sort_order` — целое, шаг 10 (как у вёдер).
- Soft-delete: `WHERE deleted_at IS NULL` во всех селектах. SPA всегда
  фильтрует.
- `CHECK (amount > 0)` — гарантия на уровне D1. Возвраты средств =
  отдельная категория `cashback`, не отрицательный income.

### Что НЕ менялось

- `expenses`, `snapshots`, `accounts`, `currencies`, `categories`,
  `rates`, `authorized_users` — без изменений.

## 6. API contract

Все эндпоинты под `/v1/web/*` требуют **Bearer JWT** (`requireAdminSession`).

### `GET /v1/web/incomes`
Список доходов. Сортировка `date DESC, created_at DESC`. Soft-deleted
исключены.

- Auth: JWT (Bearer)
- Query:
  - `limit` — int, default 1000, max 20000.
  - `from` — `YYYY-MM-DD`, инклюзивно.
  - `to` — `YYYY-MM-DD`, инклюзивно.
  - `account_id` — фильтр по ведру.
  - `category_id` — фильтр по категории.
- Response 200:
  ```json
  {
    "incomes": [
      {
        "id": "uuid",
        "date": "2026-05-24",
        "account_id": "rub-bank",
        "amount": 100000,
        "currency_code": "RUB",
        "category_id": "salary",
        "source": "Anthropic",
        "note": "За первую половину мая",
        "created_at": "2026-05-24 10:11:12",
        "updated_at": "2026-05-24 10:11:12"
      }
    ]
  }
  ```

### `GET /v1/web/income-categories`
Список активных категорий, отсортированных по `sort_order`.

- Response 200:
  ```json
  {
    "categories": [
      { "id": "salary", "name": "Зарплата", "emoji": "💼", "color": "#a78bfa", "sort_order": 10 },
      ...
    ]
  }
  ```

### `POST /v1/web/incomes`
Создание дохода. Идемпотентно по `id` (если клиент его прислал) — `INSERT OR IGNORE`.

- Body:
  ```json
  {
    "id": "uuid-v4",              // optional; auto-generate если нет
    "date": "2026-05-24",
    "account_id": "rub-bank",
    "amount": 100000,             // >0
    "category_id": "salary",
    "source": "Anthropic",        // optional
    "note": "За первую половину мая"  // optional
  }
  ```
- Response 200: `{ "ok": true, "id": "uuid", "inserted": true }`.
  `inserted=false` если уже есть строка с таким `id` (повторный вызов).
- Response 400:
  - `{ "error": "date, account_id, amount, category_id are required" }` —
    если хотя бы одно из четырёх не валидно.
  - `{ "error": "amount must be positive" }` — если `amount <= 0`.
  - `{ "error": "unknown account_id" }` — FK не нашёлся (`accounts`).
  - `{ "error": "unknown category_id" }` — FK не нашёлся.

### `PUT /v1/web/incomes/:id`
Частичный апдейт. `currency_code` обновляется автоматически если меняется
`account_id`. `note` и `source` всегда обновляются (в т.ч. на null).

- Body:
  ```json
  {
    "date"?: "...",
    "account_id"?: "...",
    "amount"?: 123,
    "category_id"?: "...",
    "source"?: null | "...",
    "note"?: null | "..."
  }
  ```
- Response 200: `{ "ok": true, "updated": true }`.
- `updated=false` если строки с таким id нет или она soft-deleted.

### `DELETE /v1/web/incomes/:id`
Soft-delete.

- Response 200: `{ "ok": true, "deleted": true }`.
- `deleted=false` если строка уже была удалена.

### Что НЕ добавляется в эту итерацию

- `/v1/web/incomes/categories` POST/PUT/DELETE — нет, категории
  только через миграции.
- `/v1/expenses` (Mini App API) **не** получает incomes endpoints.

## 7. UI / UX

### Маршрут `/incomes`

```
┌─────────────────────────────────────────────────────────────────────┐
│ Доходы                                            [+ Новый доход]   │
│ Зарплаты, проценты, подарки и всё, что увеличивает счета.           │
├─────────────────┬──────────────────────┬────────────────────────────┤
│ Этот месяц      │ Последние 12 месяцев │ Всего                      │
│ 1 050.00 EUR    │ 25 800.00 EUR        │ 25 800.00 EUR              │
│ 2 дохода        │ 18 доходов           │ 18 доходов                 │
├─────────────────┴──────────────────────┴────────────────────────────┤
│ Разбивка по категориям (последние 12 мес)                           │
│ 💼 Зарплата       ███████████████████████████░░░  85.2 %  21 900 EUR│
│ 📈 Проценты       ████░░░░░░░░░░░░░░░░░░░░░░░░░░   8.1 %   2 090 EUR│
│ 🎁 Подарки        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░   3.4 %     870 EUR│
│ ...                                                                  │
├─────────────────────────────────────────────────────────────────────┤
│ [🔍 поиск по source/note/сумме   ] [▼ Категория] [▼ Период]         │
├──────┬──────────────┬────────────┬──────────┬──────────┬────────────┤
│ Дата │ Категория    │   Сумма    │ Источник │ Заметка  │ Ведро   ✎🗑│
├──────┼──────────────┼────────────┼──────────┼──────────┼────────────┤
│24.05 │💼 Зарплата   │100 000 RUB │Anthropic │1-я пол.5 │RUB·банк ✎🗑│
│22.05 │📈 Проценты   │  3.40 USDT │Bybit Save│—         │USDT     ✎🗑│
│ ...  │              │            │          │          │            │
└──────┴──────────────┴────────────┴──────────┴──────────┴────────────┘
```

#### Состояния
- **Loading.** 3 skeleton-KPI + skeleton bars + «Загрузка…» в таблице.
- **Empty.** KPI = «0 EUR / 0 доходов»; breakdown скрыт; таблица:
  «Доходов пока нет. Заведи первый — кнопкой выше.»
- **Error на /incomes.** Если `useIncomes` падает с 5xx — баннер
  сверху таблицы «Не удалось загрузить доходы. Попробуй обновить страницу.»

#### Breakdown
- Источник: `useIncomes({ from: today - 365d })` + group by category.
- Сортировка: по EUR-сумме DESC, top-N не нужно (категорий всего 6).
- Бар = % от total EUR последних 12 мес.
- Цвет бара = `category.color`. Слева emoji + name, справа `XX.X %` и
  абсолют в EUR.

#### KPI
- **Этот месяц** = Σ EUR `WHERE date >= first_of_current_month`.
- **Последние 12 месяцев** = Σ EUR `WHERE date >= today - 365d`.
- **Всего** = Σ EUR без фильтра (только active rows).
- Под суммой — кол-во записей.

#### Поиск + фильтры
- Поиск — local fuzzy по `source`, `note`, `amount.toFixed()`, и
  `category.name`.
- `<select>` категории — все 6 + «Все».
- `<select>` период — «Этот месяц», «Последние 12 мес», «Всё время».
  По умолчанию — «Все время» (т.к. данных мало, обрезать ничего не надо).

#### Таблица
- Колонки: `date`, `category` (emoji + name), `amount` (native + small
  EUR-eq строка снизу), `source`, `note`, `account` (bucket name), actions.
- Сортировка кликом по заголовку (TanStack Table sort).
- Default sort — `date DESC`.
- Empty filter result — «Ничего не найдено».

### Модал create/edit

```
┌─────────────────────────────────────────┐
│ Новый доход                          ✕  │
├─────────────────────────────────────────┤
│ Дата                                    │
│ [2026-05-24                          ▼] │
│                                         │
│ Ведро                                   │
│ [RUB · банк                          ▼] │
│                                         │
│ Категория                               │
│ [💼 Зарплата                         ▼] │
│ ┌─────────────────────────────────────┐ │
│ │ ⎘ Из последней «Зарплата Anthropic» │ │
│ │ (100 000 RUB · 10.05.2026)          │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Сумма                          (RUB)    │
│ [100000                              ]  │
│                                         │
│ Источник (опц.)                         │
│ [Anthropic                           ]  │
│                                         │
│ Заметка (опц.)                          │
│ [За первую половину мая              ]  │
│                                         │
│         [Отмена]  [Создать]             │
└─────────────────────────────────────────┘
```

- Поля:
  - **Дата** — `type=date`, default = сегодня.
  - **Ведро** — `<select>`. Список из 7 active buckets.
  - **Категория** — `<select>`. Список из 6 active income_categories.
  - **Сумма** — `type=number, step=any, min=0.01`. Native валюта ведра
    показывается справа от лейбла (`amount` (RUB)).
  - **Источник** — `<input type="text">`, optional.
  - **Заметка** — `<input type="text">`, optional.
- **«Скопировать из последней»** — кнопка появляется только в режиме
  «Создать» и только если выбрана категория, для которой есть хотя бы
  одна запись. Pre-fill: `account_id`, `amount`, `source` из самой
  свежей записи этой категории. `date` остаётся `today`, `note` —
  пустой.
- Валидация:
  - `date` непустой.
  - `account_id` выбран.
  - `category_id` выбран.
  - `parseFloat(amount) > 0`.
  - Submit `disabled` пока не валидно или в процессе submit.
- Esc / клик по бэкдропу — закрытие (как у Snapshot modal).
- На success — `qc.invalidateQueries(["incomes"])`.

### Sidebar
- Был: «Доходы» — `disabled`.
- Стал: кликабельная ссылка на `/incomes`, иконка `TrendingUp`.

## 8. Security

- **Auth.** Все 5 web-эндпоинтов закрыты `requireAdminSession`
  (Bearer JWT HS256, allowlist email-ов из `ADMIN_ALLOWED_EMAILS`).
- **Input validation.**
  - `date`: обязательно, формат не валидируем строго (D1 хранит как
    TEXT), но в UI всегда `type="date"`.
  - `amount`: обязательно, `typeof === 'number'`, `> 0`.
  - `account_id`: обязательно, ищем в `accounts` (если нет — 400).
  - `category_id`: обязательно, ищем в `income_categories` (если нет — 400).
  - `source`, `note`: free text. Хранятся как есть (без HTML-санитизации
    на write; frontend всегда экранирует на render через React text
    nodes, не `dangerouslySetInnerHTML`).
  - Длины: D1 не лимитирует, но frontend ставит `maxLength={200}` на
    source и `maxLength={500}` на note (UX, не security).
- **PII.** Логи Worker'а не пишут amount/source/note. В случае ошибки —
  только `console.error("unhandled", err)` без body.
- **CORS.** `ADMIN_ALLOWED_ORIGINS` через shared `cors.ts`.
- **Что НЕ должно попадать в логи:** `amount`, `source` (может содержать
  «От X»), `note`, JWT, email (логируется только на login flow).
- **Никаких raw SQL из клиента.** Все параметры через `?` placeholders.

## 9. Acceptance criteria

- [ ] AC1: Миграция 0007 применима к D1 без ошибок; после неё:
  - `SELECT COUNT(*) FROM income_categories` = 6.
  - `SELECT COUNT(*) FROM incomes` = 0.
- [ ] AC2: `GET /v1/web/income-categories` (с JWT) возвращает 6 категорий
  в порядке `sort_order`.
- [ ] AC3: `POST /v1/web/incomes` с валидным body создаёт строку,
  `inserted=true`, `currency_code` совпадает с `accounts.currency`.
- [ ] AC4: `POST` без `date`/`account_id`/`amount`/`category_id` → 400.
- [ ] AC5: `POST` с `amount = -100` → 400 «amount must be positive».
- [ ] AC6: `POST` с `account_id = "no-such"` → 400 «unknown account_id».
- [ ] AC7: `POST` с `category_id = "no-such"` → 400 «unknown category_id».
- [ ] AC8: Повторный `POST` с тем же `id` → `inserted=false`,
  в D1 одна строка.
- [ ] AC9: `PUT /v1/web/incomes/:id` с `{amount: 200}` — обновляет только
  amount; `note`/`source` приводятся к null если переданы null
  явно. При `account_id` change — `currency_code` пересчитывается.
- [ ] AC10: `DELETE /v1/web/incomes/:id` ставит `deleted_at`,
  `GET /v1/web/incomes` его не возвращает.
- [ ] AC11: На `/incomes` пустом стейте показывается empty state.
- [ ] AC12: После создания дохода KPI «Этот месяц» и таблица обновляются
  без перезагрузки (queries invalidated).
- [ ] AC13: При выборе категории `Зарплата` в модале появляется кнопка
  «Из последней» если есть хотя бы одна salary-запись; pre-fill
  работает (account / amount / source).
- [ ] AC14: Breakdown by category отображает 6 категорий (или меньше,
  если в категории нет записей) в порядке EUR DESC.
- [ ] AC15: Sidebar показывает «Доходы» как кликабельный пункт.
- [ ] AC16: Stage 5a/4 регресс: `/expenses`, `/snapshots`, `/accounts`
  работают как раньше.

## 10. Test plan

### Worker (curl smoke)
- `GET /v1/web/income-categories` → 6 категорий, sort_order 10–60.
- `POST /v1/web/incomes` happy → 200, `{inserted: true}`.
- Все 400 кейсы (AC4–AC7) — отдельным curl каждый.
- Идемпотентность (AC8): POST одного и того же id 2 раза.
- `PUT` (AC9): амонут, source/note=null, account_id change.
- `DELETE` + повторный GET → строка ушла.

### D1
- `wrangler d1 execute --remote --command "SELECT * FROM income_categories"`
  после миграции.
- `wrangler d1 execute --remote --command "SELECT id, currency_code FROM incomes"`
  после POST.

### Admin SPA (ручной walkthrough)
- Открыть `https://finances-admin.pages.dev/incomes` после deploy.
- Создать 3 разных дохода (зарплата RUB, проценты USDT, подарок EUR).
- Проверить KPI пересчёт.
- Проверить breakdown отображение.
- Проверить «Скопировать из последней».
- Edit + delete.
- 401 (token=garbage в localStorage) → редирект на /login.

### Mini App regression
- Запустить трату с iPhone, она доезжает в D1 (legacy `external` ok).
- `local/scripts/test_ui.py` Playwright-сценарий — без изменений.

### Не делается в этой итерации
- Unit-тесты Worker'а: проект пока на ручном тесте (см. SPEC-005 §10).
- Playwright для Admin: backlog.

## 11. Risks & open questions

- R1: **Денормализация `currency_code` в `incomes`.** Если в будущем
  поменяется `accounts.currency` (что вообще странно, но допустим),
  старые `incomes.currency_code` будут расходиться. Митигация: ADR-014
  «не менять currency у существующего account_id; вместо этого — создать
  новое ведро и софт-удалить старое».
- R2: **`CHECK (amount > 0)` в SQL CHECK constraint.** SQLite поддерживает
  CHECK, но `INSERT OR IGNORE` его всё равно валидирует. Поведение
  ожидаемое: при amount=0 запрос упадёт с CHECK violation; Worker
  должен поймать это в 400. На уровне D1 — возможен 500, поэтому проще
  валидировать на стороне Worker'а до INSERT.
- R3: **Удаление категории.** Soft-delete категории через `is_active=0`
  не покрывает случай, когда уже есть incomes с этой `category_id`.
  Текущая логика: фронт показывает все 6 категорий, deleted-categories
  скрыты в `<select>`. Записи с старой категорией остаются (видны
  по emoji + name через JOIN).
- OQ1: **Локаль чисел.** Сейчас формат `100 000.00 EUR` (точка как
  десятичный, пробел как тысячи). Это уже стиль `/snapshots`. Если
  потребуется ru-RU («100 000,00 EUR»), сделаем централизованный helper.
- OQ2: **Pre-fill «Из последней» — а если две зарплаты от разных
  работодателей в разные ведра?** В этой итерации копируем самую
  свежую безусловно. Если станет неудобно — добавим dropdown
  «Из последних 3 записей этой категории».

## 12. Out of scope для review

- Графики time-series доходов (Stage 8).
- Сравнение income vs expenses (Stage 8 / Dashboard).
- CRUD по категориям через UI (backlog).
- Recurring (Stage 9-10 при необходимости).
- AI Coach использует `incomes` (Stage 10).

## 13. Changelog spec'а

- 2026-05-25: создан в `draft`. Discovery answers: отдельная `incomes`
  + 6 категорий + без auto-snapshot + один bucket + source-поле + ручной
  ввод + CRUD с KPI и breakdown.
- 2026-05-25: статус `in_progress` (старт Phase 2).
- 2026-05-25: Phase 2 завершён — миграция 0007 применена, Worker
  `v 57d32960` deployed, Admin SPA на `finances-admin.pages.dev` обновлён.
- 2026-05-25: Phase 3 audit fallback из-за 529 Overloaded на API
  Anthropic (5 неудачных запусков subagent'ов). Self-audit verdict:
  PASS_WITH_NICES / APPROVED_WITH_NICES, 0 must-fix, 1 should-fix
  (catById helper дублирование — починен fix-commit'ом).
- 2026-05-25: статус `done`. Roadmap обновлён, audits committed.
- 2026-07-07: обратный superseded-маркер (аудит 2026-07, SPC-08): конверсия goal-привязанного дохода — теперь поток по дате вклада (SPEC-025/ADR-020); OQ1 (пере-деривация валюты при смене счёта в edit) закрыт классово SPEC-032, для edit-потока incomes — SPEC-042 (аудит FIN-01).
