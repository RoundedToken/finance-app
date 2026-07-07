---
id: SPEC-005
title: Stage 5a — Snapshots CRUD (модель «валюта × форма» + 7 вёдер)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - adr: docs/decisions.md#adr-011
  - adr: docs/decisions.md#adr-012
  - parent: docs/roadmap.md#этап-5--снапшоты-счетов-web-admin
---

# Stage 5a — Snapshots CRUD (модель «валюта × форма» + 7 вёдер)

> **Retrospective spec.** Этап уже завершён. Документ фиксирует, что именно
> сделано, чтобы будущие этапы (5b графики, 5d Legacy-импорт, 6 доходы, 7
> транзакции/обмены) могли опереться на стабильный контракт.

## 1. Context & Problem

После Stage 4 (Web Admin Bootstrap) `/expenses` уже работал read-only, но
**ничего не было известно про балансы**: D1 хранил только 1822 исторических
расхода, привязанных к двум legacy-аккаунтам (`external` — для расходов без
источника, `acc_money_ok_rsd` — единственный реальный RSD-cash). Любой вопрос
вида «сколько у меня сейчас на руках» или «какой net worth» был неотвечаем без
ручного Excel. Параллельно стало понятно, что плодить «банк A vs банк B vs
биржа C» бессмысленно: для целей личных финансов важна только пара **(валюта,
форма)** — то есть «в чём» и «где физически» (cash или digital). Поэтому
Stage 5a — это (а) переход на модель 7 вёдер и (б) минимальный CRUD снапшотов
балансов в Web Admin, без графиков и без импорта Legacy.

## 2. Goals

- G1: Аккаунты в D1 перестроены в **7 «вёдер»** по парам валюта×форма:
  `rub-bank`, `rsd-bank`, `rsd-cash`, `eur-bank`, `eur-cash`, `usdt`,
  `try-cash`. Legacy-аккаунты (`external`, `acc_money_ok_rsd`) сохранены без
  потери исторических expenses.
- G2: Таблица `snapshots` в D1 со схемой UUID + (date, account_id, amount,
  note, source, soft-delete) и индексами по date / account_id.
- G3: Worker предоставляет CRUD по снапшотам через Bearer JWT:
  `GET/POST/PUT/DELETE /v1/web/snapshots` + агрегатный `GET /v1/web/accounts`
  (вёдра + последний снапшот для каждого).
- G4: Web Admin SPA — страница `/accounts` с 7 карточками (last balance в
  native + EUR-эквивалент + дата) и summary (net worth, заполненность,
  дата курсов).
- G5: Web Admin SPA — страница `/snapshots` с таблицей, поиском, фильтром
  по ведру и модальным окном create/edit. Модал показывает подсказку
  «прошлый: X, дельта Y» по выбранному ведру.
- G6: Sidebar активирован для разделов «Счета» и «Снапшоты».

## 3. Non-Goals

- NG1: **Графики** (balance over time, net worth stacked area, sparklines) —
  отложены в Stage 5b: на момент 5a данных слишком мало (0 снапшотов на
  старте), графики оживут после Stages 6/7.
- NG2: **Импорт Legacy snapshots** из `data/legacy/Finances.xlsx` (33 строки
  в EUR-eq) — отложен в Stage 5d: решено начать с чистого листа, обратная
  конверсия по историческим курсам сделана не будет в этой итерации.
- NG3: **Доходы и обмены** — это Stage 6/7. В Stage 5a баланс просто
  фиксируется снапшотом, никакой логики «приход/расход/обмен» нет.
- NG4: **Удаление legacy-аккаунтов.** `external` остаётся
  `is_active=0, form='external'`; `acc_money_ok_rsd` остаётся как первичный
  RSD-cash bucket. Не трогаем — на них висят 1822 исторических expenses.
- NG5: **Mini App никак не меняется.** Снапшоты — только Web Admin.
- NG6: Никаких **новых валют** кроме TRY (добавлена потому, что `try-cash`
  ведро требует её в `currencies`).

## 4. User journeys

### Happy path — первый снапшот
1. Стёпа логинится в Web Admin через Google OAuth (allowlisted email).
2. Открывает `/accounts` — видит 7 карточек, все «Снапшотов нет» (dashed).
   В summary: Net worth 0.00 EUR, «Заполнено вёдер: 0 / 7».
3. Тыкает на любую карточку (или кнопку «Снапшоты» в правом верхнем углу) —
   переходит на `/snapshots`.
4. На `/snapshots` нажимает «Новый снапшот». Открывается модал.
5. Выбирает ведро (например `RUB · банк`), вводит сумму (например 150000),
   дату (по умолчанию сегодня), опционально описание («зарплата за май»).
6. Жмёт «Создать». Модал закрывается, в таблице появляется строка.
7. Возвращается на `/accounts` — карточка `RUB · банк` показывает 150 000 RUB
   и EUR-эквивалент. Summary показывает Net worth ≠ 0 и «1 / 7».

### Happy path — корректировка
1. Стёпа понял, что в снапшоте опечатка. Открывает `/snapshots`,
   находит строку (поиск по описанию / фильтр по ведру).
2. Жмёт иконку «карандаш». Открывается модал с заполненными полями.
3. Видит подсказку под суммой: «Прошлый: 150 000.00 RUB от 24.05.2026
   · +50 000.00» (если предыдущий снапшот того же ведра существует).
4. Меняет сумму на 145 000. Жмёт «Сохранить».
5. Таблица обновляется. Карточка на `/accounts` тоже (queries invalidated).

### Happy path — удаление
1. Стёпа жмёт «корзина» в строке снапшота.
2. Браузерный `confirm()` показывает: `Удалить снапшот? RUB · банк ·
   145 000.00 · 24.05.2026`. Стёпа подтверждает.
3. Soft-delete (set `deleted_at`). Из таблицы и из «last snapshot»
   на карточке строка исчезает.

### Edge cases
- E1: **Аккаунт ещё ни разу не получал снапшот** — карточка показывает
  иконку `AlertCircle` и текст «Снапшотов нет», border = dashed.
- E2: **JWT истёк** (401) — `apiFetch` чистит localStorage и редиректит на
  `/login` (поведение унаследовано из Stage 4).
- E3: **POST с битым телом** (нет `date` / `account_id` / `amount` не число)
  — Worker возвращает 400 «date, account_id, amount are required».
- E4: **Сумма 0** — валидна (например «снапшот после полного вывода средств»).
- E5: **Курсы не подгрузились** (`refs.rates.quotes` пустое) — EUR-эквивалент
  для не-EUR ведра 0; в summary показывается «—» как дата курсов.
- E6: **DELETE уже удалённого** — `UPDATE ... WHERE deleted_at IS NULL`
  возвращает `changes=0`, `deleted=false`. SPA invalidate-ит query
  и таблица «самовосстанавливается».
- E7: **Два снапшота за одну дату для одного ведра** — допустимо. В
  `latestSnapshotPerAccount` сортировка `(date, created_at)` берёт более
  поздний по `created_at`. (Дубликаты по идентичному UUID отсекаются
  `INSERT OR IGNORE`.)

## 5. Data model

### Миграция 0006 (D1)

```sql
-- cloud/worker/migrations/0006_buckets_and_snapshots.sql

-- 1) Расширяем accounts
ALTER TABLE accounts ADD COLUMN form TEXT NOT NULL DEFAULT 'digital';
ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;

-- 2) Маркируем legacy: external pseudo-account и старый RSD cash
UPDATE accounts SET form = 'external', is_active = 0
 WHERE id = 'external';

UPDATE accounts
   SET form = 'cash',
       name = 'RSD · нал',
       type = 'cash',
       sort_order = 30,
       color = '#fbbf24'
 WHERE id = 'acc_money_ok_rsd';

-- 3) Новые 6 вёдер
INSERT INTO accounts (id, name, type, currency, is_active, form, sort_order, color)
VALUES
    ('rub-bank', 'RUB · банк', 'bank',   'RUB',  1, 'digital', 10, '#a78bfa'),
    ('rsd-bank', 'RSD · банк', 'bank',   'RSD',  1, 'digital', 20, '#fdba74'),
    ('eur-bank', 'EUR · банк', 'bank',   'EUR',  1, 'digital', 40, '#34d399'),
    ('eur-cash', 'EUR · нал',  'cash',   'EUR',  1, 'cash',    50, '#86efac'),
    ('usdt',     'USDT',       'crypto', 'USDT', 1, 'digital', 60, '#22d3ee'),
    ('try-cash', 'TRY · нал',  'cash',   'TRY',  1, 'cash',    70, '#fb7185');

-- 4) Валюта TRY (если ещё нет)
INSERT OR IGNORE INTO currencies (code, name, emoji, is_crypto, decimals)
VALUES ('TRY', 'Турецкая лира', '🇹🇷', 0, 2);

-- 5) snapshots
CREATE TABLE IF NOT EXISTS snapshots (
    id          TEXT PRIMARY KEY,                    -- UUID v4 (см. ADR-005)
    date        TEXT NOT NULL,                        -- YYYY-MM-DD
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    amount      REAL NOT NULL,                        -- native currency аккаунта
    note        TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_date         ON snapshots(date);
CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON snapshots(account_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_active_date  ON snapshots(date) WHERE deleted_at IS NULL;
```

### Семантика полей

- `accounts.form ∈ {cash, digital, external}` — физическая форма ведра.
  Карточка с `form='cash'` рисуется с иконкой `Banknote`, остальные с
  `Coins`. `external` — pseudo, скрывается от пользователя через
  `WHERE form != 'external'` в `listBuckets`.
- `accounts.sort_order` — целое, шаг 10. Определяет порядок карточек на
  `/accounts` и в select'ах. Текущее распределение: 10/20/30/40/50/60/70.
- `accounts.deleted_at` — soft-delete; SPA всегда фильтрует `IS NULL`.
- `snapshots.amount` хранится в **native currency аккаунта** (RUB для
  `rub-bank`, EUR для `eur-bank` и т.д.). Никаких конверсий на write.
  EUR-эквивалент считается на read во фронте через `refs.rates`.
- `snapshots.source` — пока только `'manual'`; зарезервировано под
  `'legacy_import'` (Stage 5d) и автоматические снапшоты по транзакциям
  (Stage 7).
- `snapshots` **не имеет** `currency` колонки — она выводится через
  JOIN с `accounts.currency`.

### Что НЕ менялось

- `expenses` — 1822 строки нетронуты. `account_id` по-прежнему ссылается
  на `external` или `acc_money_ok_rsd` (теперь это RSD-cash bucket).
- `categories`, `currencies` (кроме добавления TRY), `rates`,
  `authorized_users` — без изменений.

## 6. API contract

Все Web-эндпоинты требуют **Bearer JWT** в заголовке `Authorization` (см.
`requireAdminSession`); 401 при отсутствии/невалидном токене.

### `GET /v1/web/accounts`
Список активных вёдер + последний снапшот для каждого.
- Auth: JWT (Bearer)
- Query: —
- Response 200:
  ```json
  {
    "accounts": [
      {
        "id": "rub-bank",
        "name": "RUB · банк",
        "type": "bank",
        "currency": "RUB",
        "form": "digital",
        "sort_order": 10,
        "color": "#a78bfa",
        "is_active": 1,
        "latest_snapshot": { "id": "uuid", "date": "2026-05-24", "amount": 150000 }
      },
      ...
    ]
  }
  ```
- `latest_snapshot` = `null` если у аккаунта нет ни одного активного снапшота.
- Возвращаются только вёдра с `form != 'external' AND deleted_at IS NULL`
  (то есть legacy `external` скрыт, `acc_money_ok_rsd` виден как
  «RSD · нал»).

### `GET /v1/web/snapshots`
- Query: `limit` (default 1000, max 20000), `from` (YYYY-MM-DD, инклюзивно),
  `account_id` (фильтр по ведру).
- Response 200:
  ```json
  {
    "snapshots": [
      {
        "id": "uuid",
        "date": "2026-05-24",
        "account_id": "rub-bank",
        "amount": 150000,
        "note": "зарплата за май",
        "source": "manual",
        "created_at": "2026-05-24 10:11:12",
        "updated_at": "2026-05-24 10:11:12"
      },
      ...
    ]
  }
  ```
- Сортировка: `date DESC, created_at DESC`. Soft-deleted (`deleted_at IS NOT NULL`)
  исключены.

### `POST /v1/web/snapshots`
Создание снапшота. Идемпотентно по `id` (если клиент его прислал) — `INSERT OR IGNORE`.
- Body:
  ```json
  {
    "id": "uuid-v4",                  // optional; если нет — сгенерится на сервере
    "date": "2026-05-24",
    "account_id": "rub-bank",
    "amount": 150000,
    "note": "зарплата за май",        // optional
    "source": "manual"                // optional, default "manual"
  }
  ```
- Response 200: `{ "ok": true, "id": "uuid", "inserted": true }`.
  `inserted=false` если уже есть строка с таким `id` (повторный вызов).
- Response 400: `{ "error": "date, account_id, amount are required" }` —
  если хотя бы одно из трёх обязательных полей не валидно
  (нет/`typeof amount !== 'number'`).

### `PUT /v1/web/snapshots/:id`
Частичный апдейт. Все поля опциональны; `note` всегда обновляется (в т.ч. на null).
- Body:
  ```json
  { "date"?: "...", "account_id"?: "...", "amount"?: 123, "note"?: "..." }
  ```
- Response 200: `{ "ok": true, "updated": true }`.
- `updated=false` если строки с таким id нет или она soft-deleted.

### `DELETE /v1/web/snapshots/:id`
Soft-delete: `UPDATE ... SET deleted_at = datetime('now')`.
- Response 200: `{ "ok": true, "deleted": true }`.
- `deleted=false` если строка уже была удалена.

### Что не добавлялось в этой итерации

- Нет публичного эндпоинта для `listBuckets` без снапшотов
  (используется только внутри `/v1/web/accounts`).
- Нет bulk-import эндпоинта (это Stage 5d).
- Mini App API (`/v1/expenses` и т.п.) не получает доступа к snapshots
  (см. ADR-012: scope Mini App = только расходы).

## 7. UI / UX

### Маршрут `/accounts`

```
┌─────────────────────────────────────────────────────────────────┐
│ Счета                                              [+ Снапшоты] │
│ Семь вёдер по парам валюта × форма. Баланс = последний снапшот. │
├──────────────────────┬──────────────────────┬───────────────────┤
│ Net worth (EUR)      │ Заполнено вёдер      │ Курсы от даты     │
│ 3 210.99 EUR         │ 5 / 7                │ 2026-05-24        │
│                      │ есть пустые          │ Источник:GFINANCE │
├──────────────────────┴──────────────────────┴───────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                          │
│ │RUB · банк│ │RSD · банк│ │RSD · нал │ ...                      │
│ │150000RUB │ │ 21000RSD │ │  9500RSD │                          │
│ │1 900 EUR │ │  170 EUR │ │   67 EUR │                          │
│ │от 24.05  │ │от 22.05  │ │от 20.05  │                          │
│ └──────────┘ └──────────┘ └──────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

- Карточка — `<Link to="/snapshots" search={{ account_id: acc.id }}>` (хотя
  параметр пока не используется на `/snapshots`, ссылка ведёт на список —
  расширим в Stage 5b).
- Пустая карточка (без снапшота) — `border-dashed`, иконка
  `AlertCircle` + текст «Снапшотов нет».
- Иконка ведра: `Banknote` для `form='cash'`, `Coins` для остального.
- Цвет фона иконки = `acc.color + "22"` (alpha 0.13).
- States: loading → 6 skeleton-карточек (`animate-pulse bg-muted/40 h-36`).

### Маршрут `/snapshots`

```
┌─────────────────────────────────────────────────────────────────┐
│ Снапшоты                                    [+ Новый снапшот]   │
│ Каждый снапшот — фиксация баланса одного ведра на конкретную дату │
├─────────────────────────────────────────────────────────────────┤
│ [🔍 поиск по описанию, ведру, сумме…       ] [▼ Все вёдра    ]  │
├──────┬────────────┬────────────┬───────────────────┬────────────┤
│ Дата │ Ведро      │     Сумма  │ Описание          │ ✎  🗑      │
├──────┼────────────┼────────────┼───────────────────┼────────────┤
│24.05 │🟪 RUB·банк │ 150 000 RUB│ зарплата за май   │ ✎  🗑      │
│22.05 │🟦 USDT     │     420 USDT│ —                 │ ✎  🗑      │
│ ...  │            │            │                   │            │
└──────┴────────────┴────────────┴───────────────────┴────────────┘
```

- Empty state: «Снапшотов пока нет. Заведи первый — кнопкой выше.»
- Loading: «Загрузка…» (полная строка таблицы).
- Поиск по `note`, по строковой форме `amount`, по `accounts.name`.
- Filter `select` со списком всех 7 вёдер (значение «» = все).
- Edit (`Pencil`) — открывает модал с предзаполненными полями.
- Delete (`Trash2`) — `window.confirm()` с человеческой подписью
  «Удалить снапшот? RUB · банк · 150 000.00 · 24.05.2026».

### Модал create/edit

- Поля: Ведро (`<select>`), Сумма (`type=number, step=any, min=0`),
  Дата (`type=date`), Описание (`<input>`, опционально).
- Подсказка под суммой (только если у выбранного ведра есть
  `latest_snapshot`): «Прошлый: 150 000.00 RUB от 24.05 · **+50 000.00**»
  (зелёный/красный в зависимости от знака дельты).
- Валидация: `valid = !!date && !!account_id && parseFloat(amount) >= 0`.
  Submit disabled пока не валидно или пока submitting.
- Esc / клик по бэкдропу — закрытие.
- На success — `qc.invalidateQueries(["snapshots"])` + `["accounts"]`.

### Sidebar

В `AppLayout.tsx` уже видны два пункта (Stage 4 их завёл, но они были
`disabled`; Stage 5a их активировал):
- `/accounts` — иконка `Wallet`, label «Счета».
- `/snapshots` — иконка `PieChart`, label «Снапшоты».

## 8. Security

- **Auth.** Все 5 web-эндпоинтов закрыты `requireAdminSession` (Bearer JWT
  HS256, allowlist email-ов из `ADMIN_ALLOWED_EMAILS`). Mini App initData
  для них **не принимается** (специально).
- **Input validation.** На POST минимально: `date`, `account_id`, `amount`
  обязательны; `typeof amount === 'number'`. **Нет** проверки, что
  `account_id` существует в `accounts` — ловится FOREIGN KEY на write
  (вернёт 500, но это допустимо: web интерфейс показывает только
  существующие вёдра в `<select>`).
- **PII / финансовые данные.** Логи Worker'а не пишут сами суммы или
  `note`. В случае ошибки логируется только `console.error("unhandled", err)`
  без тела запроса.
- **CORS.** `ADMIN_ALLOWED_ORIGINS` ограничивает Origin для Admin.
  Mini App остаётся `*` (initData валидируется HMAC, см. ADR-005).
- **Что не должно попадать в логи:** `note` (может содержать «зарплата от …»),
  суммы, email пользователя из JWT (логируется только на login flow).

## 9. Acceptance criteria

- [x] AC1: Миграция 0006 применима к D1 без ошибок;
      после неё `SELECT id, form FROM accounts` возвращает 8 строк
      (`external`, `acc_money_ok_rsd` + 6 новых).
- [x] AC2: `GET /v1/web/accounts` возвращает ровно 7 вёдер (без `external`).
- [x] AC3: `POST /v1/web/snapshots` с валидным body создаёт строку,
      `inserted=true`; повторный вызов с тем же `id` возвращает `inserted=false`.
- [x] AC4: `POST /v1/web/snapshots` без `date`/`account_id`/`amount` возвращает
      400 «date, account_id, amount are required».
- [x] AC5: `PUT /v1/web/snapshots/:id` с `{amount: 100}` обновляет только
      `amount` (другие поля не сбрасываются, кроме `note`, который всегда
      приводится к переданному значению / null).
- [x] AC6: `DELETE /v1/web/snapshots/:id` ставит `deleted_at`, после чего
      строка не возвращается ни в `GET /v1/web/snapshots`, ни в
      `latest_snapshot` поле `/v1/web/accounts`.
- [x] AC7: На `/accounts` для каждого ведра без снапшота отображается
      «Снапшотов нет» + dashed border.
- [x] AC8: На `/accounts` Net worth = Σ (latest_snapshot.amount / rate[currency])
      для всех 7 вёдер (для EUR — деление не применяется).
- [x] AC9: На `/snapshots` после create/edit/delete таблица и summary
      обновляются автоматически (без перезагрузки страницы) благодаря
      `invalidateQueries`.
- [x] AC10: Модал create/edit при выборе ведра с историей показывает строку
      «Прошлый: X от DD.MM · ±Δ» с цветом дельты (positive/negative).
- [x] AC11: 1822 исторических expenses остаются доступны на `/expenses`
      без модификаций.
- [x] AC12: Sidebar показывает «Счета» и «Снапшоты» как кликабельные
      (не disabled).

## 10. Test plan

- **Worker.** Ручные curl smoke-tests:
  - `GET /v1/web/accounts` с Bearer токеном → 7 вёдер с `latest_snapshot=null`.
  - `POST /v1/web/snapshots` happy → `{ok:true, inserted:true}`.
  - `POST /v1/web/snapshots` без `amount` → 400.
  - `PUT` + `GET` → проверка частичного обновления.
  - `DELETE` + повторный `GET` → строка исчезла.
- **D1.** `wrangler d1 execute` с проверочными SELECT'ами после миграции
  (см. AC1, AC2).
- **Admin SPA.** Ручной walkthrough на `https://finances-admin.pages.dev`:
  открыть `/accounts`, создать снапшот, отредактировать, удалить.
  Проверить, что Net worth пересчитывается.
- **Mini App regression.** Запустить трату с iPhone → она доезжает в D1
  (legacy `external` account по-прежнему принимает). `local/scripts/test_ui.py`
  Playwright-сценарий проходит без изменений.
- **Out of scope для авто-тестов:** unit-тесты не пишутся (проект пока
  ручной), но эндпоинты покрыты е2е curl-набором.

## 11. Risks & open questions

- R1: **Нет валидации account_id на сервере.** Если фронт по ошибке передаст
  несуществующий id, Worker вернёт 500 (FK violation в D1). Принято:
  достаточно, потому что UI всегда выбирает из существующих вёдер.
- R2: **Latest snapshot tie-breaker — `created_at`.** Если два снапшота с
  одной `date` и почти одинаковым `created_at` (миллисекундная точность),
  ORDER BY может дать недетерминированный результат. На практике не
  встречается; в Stage 5b при появлении графиков может потребоваться явный
  `inserted_seq INTEGER`.
- R3: **Schema drift.** `cloud/worker/schema.sql` синхронизируется руками
  с `migrations/`. Stage 5a добавил `snapshots` и колонки `accounts` в оба
  файла — но в будущем легко забыть. Митигировано общим правилом из
  CLAUDE.md «schema.sql обновляется параллельно».
- OQ1: **Двойной снапшот в один день для одного ведра** — это feature
  или bug? Сейчас разрешено (например, «утром 1000 EUR, после обмена
  вечером 950 EUR»). Если станет неудобно — в 5b добавить UNIQUE на
  `(account_id, date)` или модальное предупреждение.
- OQ2: **`acc_money_ok_rsd` как «RSD · нал»** — корректное переименование
  с точки зрения исторических expenses? Да, потому что 1822 expenses в нём
  как раз и были «нал в RSD». Просто теперь у ведра нормальное человеческое
  имя.
- OQ3: **`source='manual'` всегда** — в будущем (5d, Stage 7) появятся
  `legacy_import` и `auto_after_transaction`. Договоримся пополнять список
  значений в этой же spec'е как ADR-приложение.

## 12. Out of scope для review

- Графики и aggregations по времени — это **5b**, явно отложено.
- Импорт `data/legacy/Finances.xlsx` (33 EUR-eq снимка) — это **5d**,
  явно отложено.
- Lint-warnings типа «`Modal` мог бы быть более reusable» — пока хватит
  текущей реализации.
- Mini App не должен ничего знать о snapshots — это by design (ADR-012).

## 13. Changelog spec'а

- 2026-05-25: Spec написан retrospectively, статус сразу `done`. Stage 5a
  реализован полностью; миграция 0006 применена в проде; страницы
  `/accounts` и `/snapshots` развёрнуты на `finances-admin.pages.dev`.
