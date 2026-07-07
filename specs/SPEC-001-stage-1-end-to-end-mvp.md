---
id: SPEC-001
title: Stage 1 — End-to-End MVP (iPhone → Worker → D1)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - adr: docs/decisions.md#adr-009
  - adr: docs/decisions.md#adr-011
  - roadmap: docs/roadmap.md
---

# Stage 1 — End-to-End MVP

> **Retrospective spec.** Этот документ описывает уже реализованный Stage 1 (на момент создания этого spec'а — уже в production, см. `docs/roadmap.md`).
> Часть деталей (особенно `D1` как ground truth, удалённые `expenses_outbox`/`device_heartbeats`) отражает состояние **после** D1-centric pivot (ADR-011), к которому Stage 1 эволюционировал.

## 1. Context & Problem

После Этапа 0 (инфраструктура, документация, brew/wrangler/Cloudflare account, схемы) — нужно было собрать минимальную **сквозную цепочку**, доказывающую жизнеспособность архитектуры: пользователь нажимает на цифры в Telegram Mini App с iPhone, и через ~секунду эта трата лежит в Cloudflare D1.

Без такого end-to-end smoke-теста все последующие этапы (импорт CSV, аналитика, Web Admin) — спекуляция. Нужен «hello world», который проходит весь стек: Telegram WebApp → HTTPS → Worker → initData HMAC validation → whitelist check → D1 INSERT.

## 2. Goals

- **G1**: Cloudflare Worker задеплоен на `*.workers.dev`, отвечает на `GET /healthz` → `200 {"ok":true}`.
- **G2**: D1 database `finances-outbox` создана; миграции 0001–0004 применены; есть таблицы `expenses`, `accounts`, `categories`, `currencies`, `authorized_users`.
- **G3**: Telegram bot подключён к Worker через webhook `/tg`; команда `/start` от whitelisted-пользователя получает ответ, от non-whitelisted — **молчание** (только лог).
- **G4**: Mini App (HTML/CSS/JS) задеплоен на Cloudflare Pages, открывается из бота через `setChatMenuButton`.
- **G5**: Mini App при старте получает bootstrap (accounts/categories/currencies) через `GET /v1/bootstrap` с `X-Telegram-Init-Data` авторизацией.
- **G6**: Mini App может создать трату через `POST /v1/expenses`, и она появляется в D1 (`SELECT * FROM expenses` через `wrangler d1 execute`).
- **G7**: Идемпотентность: повторный `POST` с тем же `id` (UUID v4) не создаёт дубль (`INSERT OR IGNORE`).
- **G8**: Smoke-test пройден вживую — реальная трата с iPhone в Telegram дошла до D1.

## 3. Non-Goals

- **NG1**: Полноценный UI Mini App (категории-слайдер, аналитика, edit-modal, swipe-to-delete). Это Stage 2/3.
- **NG2**: Курсы валют, конверсия в базовую валюту. Это Stage 3 (ADR-006).
- **NG3**: Импорт исторических данных из CSV «Расходы ОК». Это Stage 4.
- **NG4**: Web Admin (Google OAuth, JWT, React-фронт). Это Stage 4 в новой нумерации (ADR-012).
- **NG5**: MacBook sync (`sync.py`, heartbeats, outbox cleanup) — в первой версии Stage 1 был запланирован, **но удалён после D1-centric pivot** (ADR-011). На момент закрытия Stage 1 MacBook участвует только как ежедневный backup (`backup_d1.py`).
- **NG6**: Снапшоты балансов, доходы, переводы между счетами. Stage 5+.

## 4. User journeys

### Happy path — whitelisted user

1. Stepan открывает Telegram → находит `@<bot_username>`.
2. Нажимает кнопку «Finances» в menu chat (настроено через `@BotFather` → `setChatMenuButton`).
3. Telegram открывает Mini App URL (`https://finances-miniapp.pages.dev/`) внутри WebView.
4. Mini App вызывает `Telegram.WebApp.ready()` + `expand()`, читает `initData` из `window.Telegram.WebApp`.
5. Mini App делает `GET /v1/bootstrap` с заголовком `X-Telegram-Init-Data: <initData>`.
6. Worker валидирует initData (HMAC-SHA256 от `WebAppData`-derived key + bot token), извлекает `user.id`, проверяет `authorized_users`.
7. Worker возвращает `{accounts, categories, currencies, expenses, rates}`.
8. Mini App рендерит numpad + сетку категорий + историю последних трат.
9. Stepan тапает цифры → выбирает категорию → Mini App генерирует UUID v4, делает `POST /v1/expenses {id, date, amount, currency, category_id, note?, source: "mini_app", created_at}`.
10. Worker: validate initData → whitelist → `INSERT OR IGNORE INTO expenses (..., user_id=<telegram_id>, ...)` → возвращает `{ok: true, inserted: true}`.
11. Mini App показывает toast «✓ записано».

### Happy path — Telegram bot text fallback

1. Whitelisted user отправляет в чат `50 EUR food продукты`.
2. Telegram → POST к Worker `/tg` webhook → `handleTelegramUpdate`.
3. Worker валидирует authorization через `isAuthorizedUser(telegram_id)`.
4. Worker парсит `<amount> <currency> <category> [note]` regex'ом, генерит UUID v4, `INSERT INTO expenses (..., source='telegram_bot', ...)`.
5. Бот отвечает: `✅ Записано: 50 EUR / food` + первые 8 символов UUID.

### Edge cases

- **E1 — Unauthorized Telegram user.** Любой человек, нашедший бота, пишет сообщение. Worker логирует `event: unauthorized_attempt` с `user_id/username/text_preview`, **не отвечает в чат** (ADR-009).
- **E2 — Invalid initData (Mini App).** Mini App не открыт из Telegram (например, прямой URL в браузере) → `initData` пустой → Worker возвращает `401 {"error":"unauthorized"}`. Mini App показывает ошибку bootstrap.
- **E3 — initData валидный, но пользователь не в whitelist.** Worker возвращает `403 {"error":"forbidden"}`.
- **E4 — Дубль UUID при повторной отправке (например, retry на flaky network).** `INSERT OR IGNORE` → `meta.changes === 0` → `{ok:true, inserted:false}`. Без ошибки клиенту.
- **E5 — Bad parse в bot tekst-mode.** `привет` или другая команда без формата → бот отвечает `❓ Не понял. Формат: 50 EUR food продукты`.
- **E6 — Bad JSON в POST /v1/expenses.** Worker возвращает `400 {"error":"bad json"}`.
- **E7 — 404 — несуществующий endpoint.** `{"error":"not found"}`.

## 5. Data model

D1 database `finances-outbox` (имя историческое; см. ADR-011 «бывший outbox-буфер, ставший ground truth»; renaming откладывается, чтобы не ломать `wrangler.toml` + production webhook).

Миграции, релевантные Stage 1 (in `cloud/worker/migrations/`):

```
0001_device_heartbeats.sql    — таблица device_heartbeats (дроп в 0004 после ADR-011)
0002_expenses_cache.sql       — expenses_cache (дроп в 0004)
0003_expenses_full.sql        — основная таблица expenses (ground truth после ADR-011)
0004_drop_legacy.sql          — DROP expenses_outbox, expenses_cache, device_heartbeats, rate_limit
```

Текущий снапшот схемы — `cloud/worker/schema.sql`. Релевантные для Stage 1 таблицы:

```sql
-- Whitelist (ADR-009)
CREATE TABLE authorized_users (
    telegram_id  TEXT PRIMARY KEY,
    name         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Справочники
CREATE TABLE accounts (
    id, name, type, currency, is_active, color, form, sort_order, deleted_at, updated_at
);
CREATE TABLE categories (
    id, name, type, parent_id, emoji, color, sort_order, is_active, updated_at
);
CREATE TABLE currencies (
    code PRIMARY KEY, name, emoji, is_crypto, decimals
);

-- Транзакционная: расходы (ground truth)
CREATE TABLE expenses (
    id                TEXT PRIMARY KEY,    -- UUID v4 от клиента
    user_id           TEXT NOT NULL,        -- Telegram ID владельца
    date              TEXT NOT NULL,        -- YYYY-MM-DD
    account_id        TEXT REFERENCES accounts(id),
    amount            REAL NOT NULL,
    currency          TEXT NOT NULL,
    category_id       TEXT REFERENCES categories(id),
    note              TEXT,
    source            TEXT NOT NULL DEFAULT 'mini_app',  -- 'mini_app' | 'telegram_bot' | 'migration'
    source_record_id  TEXT,                              -- для идемпотентности импортов
    created_at        TEXT NOT NULL,                     -- ISO-8601 от клиента
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at        TEXT                               -- soft delete
);
CREATE INDEX idx_expenses_date     ON expenses(date);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_active   ON expenses(date) WHERE deleted_at IS NULL;
```

**Семантика:**
- `id` — UUID v4 строкой; первичный ключ; **генерится на клиенте** для идемпотентности.
- `amount` — REAL, в native currency. Конверсии в этой таблице нет.
- `currency` — ISO-4217 (EUR, USD, RUB, RSD) или USDT для крипты.
- `source` — кто записал. Stage 1 знает только `'mini_app'` (Mini App) и `'telegram_bot'` (bot text-mode).
- `user_id` — Telegram ID, в Stage 1 всегда `'<TELEGRAM_ID>'` (Stepan, единственный whitelisted user).
- `deleted_at` — soft delete; в Stage 1 не задействован (DELETE добавлен в API для Stage 2).

## 6. API contract

Все endpoints на `https://finances-worker.<owner>.workers.dev`. Реализация: `cloud/worker/src/index.ts`.

### `POST /tg` — Telegram webhook

- **Auth**: нет; URL — secret-by-obscurity (но Telegram-token валидируется при отправке `setWebhook`).
- **Body**: Telegram `Update` JSON.
- **Response**: `200 {"ok":true}` всегда (Telegram ждёт 200, иначе ретраит).
- **Side effect**: Если `message.from.id` в `authorized_users` и текст парсится — `INSERT INTO expenses ... source='telegram_bot'`, ответ через `sendMessage` API. Иначе — лог `unauthorized_attempt` (ADR-009) и **молчание**.

### `GET /v1/bootstrap` — Initial data

- **Auth**: `X-Telegram-Init-Data` header. Worker валидирует HMAC (`auth.ts::validateInitData`) и whitelist.
- **Response 200**:
  ```json
  {
    "accounts":    [{"id":"...","name":"...","type":"...","currency":"...","is_active":1, "color":"..."}],
    "categories":  [{"id":"...","name":"...","type":"expense","emoji":"🥖","color":"...","sort_order":0}],
    "currencies":  [{"code":"EUR","name":"Euro","emoji":"🇪🇺","is_crypto":0,"decimals":2}],
    "expenses":    [/* до 20000 последних */],
    "rates":       {"date":"2026-05-24","base":"EUR","quotes":{"USD":1.08,...}}
  }
  ```
- **Response 401**: `{"error":"unauthorized"}` — bad initData hash или missing header.
- **Response 403**: `{"error":"forbidden"}` — user не в `authorized_users`.

### `GET /v1/expenses?from=YYYY-MM-DD&limit=N` — List

- **Auth**: `X-Telegram-Init-Data`.
- **Query**: `from` (опционально, фильтр `date >= ?`), `limit` (default 500, max 20000).
- **Response 200**: `{"expenses":[...]}`. Сортировка: `date DESC, created_at DESC`.

### `POST /v1/expenses` — Create

- **Auth**: `X-Telegram-Init-Data`.
- **Body**:
  ```json
  {
    "id":           "uuid-v4",
    "date":         "2026-05-25",
    "amount":       1850.0,
    "currency":     "RSD",
    "category_id":  "food",
    "account_id":   null,
    "note":         "магнит",
    "source":       "mini_app",
    "created_at":   "2026-05-25T10:30:00.000Z"
  }
  ```
- **Response 200**: `{"ok":true,"inserted":true}` или `{"ok":true,"inserted":false}` если дубль по `id`.
- **Response 400**: `{"error":"bad json"}`.

### `PUT /v1/expenses/:id` — Update (Stage 2, но реализован в Stage 1 worker'е)

- **Auth**: `X-Telegram-Init-Data`. Дополнительный гард: `WHERE user_id = ?` — нельзя править чужие.
- **Body**: partial patch — любые из `{date, amount, currency, category_id, account_id, note}`.
- **Response 200**: `{"ok":true,"updated":true|false}`.

### `DELETE /v1/expenses/:id` — Soft delete (Stage 2, реализован для полноты)

- **Auth**: `X-Telegram-Init-Data` + `user_id` гард.
- **Side effect**: `UPDATE expenses SET deleted_at = datetime('now')`.
- **Response 200**: `{"ok":true,"deleted":true|false}`.

### `GET /healthz` — Public

- **Auth**: нет.
- **Response 200**: `{"ok":true}`.

## 7. UI / UX

Stage 1 Mini App (`cloud/miniapp/public/`) — минимальный одностраничный SPA:

```
┌────────────────────────────────────────┐
│ ☰        0    🇷🇸 RSD       📜 (history)│  ← topbar
├────────────────────────────────────────┤
│  ┌───┐ ┌───┐ ┌───┐                     │
│  │ 1 │ │ 2 │ │ 3 │                     │
│  ├───┤ ├───┤ ├───┤                     │  ← numpad (12 кнопок)
│  │ 4 │ │ 5 │ │ 6 │                     │
│  ├───┤ ├───┤ ├───┤                     │
│  │ 7 │ │ 8 │ │ 9 │                     │
│  ├───┤ ├───┤ ├───┤                     │
│  │ . │ │ 0 │ │ ⌫ │                     │
│  └───┘ └───┘ └───┘                     │
├────────────────────────────────────────┤
│ [🇷🇸 RSD] [📅 сегодня] [💬 описание]   │  ← side-actions
├────────────────────────────────────────┤
│ ┌──┐┌──┐┌──┐┌──┐                       │
│ │🥖││🚌││💊││🏠│  ...                   │  ← сетка категорий (8 на страницу)
│ └──┘└──┘└──┘└──┘                       │
│        • • •                           │  ← pager
├────────────────────────────────────────┤
│ Сегодня · ПТ                  1850 ₽   │  ← recent days (минимум для smoke-теста)
└────────────────────────────────────────┘
```

Состояния:
- **Loading**: bootstrap ещё не отработал → пустые сетки, `recent-days` показывает «Загрузка…».
- **Bootstrap error**: `bootstrapError` set → toast «Ошибка: <msg>». Numpad всё равно интерактивен, но `POST` упадёт.
- **Empty**: 0 трат → `recent-days` пуст (рендер не выводит ничего, OK для MVP).
- **Submit success**: toast `✓ 1850 RSD → 🥖 food`, optimistic update: запись добавлена в `state.expenses` сразу, до response.
- **Submit error**: запись откатывается из `state.expenses`, toast `Ошибка: <msg>`.

## 8. Security

### Auth-checks

- **Mini App API (`/v1/*`)**: `X-Telegram-Init-Data` обязательно. Проверка:
  1. HMAC-SHA256(secret=`HMAC("WebAppData", bot_token)`) от dataCheckString (отсортированные `key=value\n...`).
  2. Сравнение с `hash` параметром.
  3. Парсинг `user` JSON, `user.id` → проверка в `authorized_users`.
  4. Реализация: `cloud/worker/src/auth.ts::validateInitData`.
- **Telegram bot (`POST /tg`)**: нет auth на endpoint, **но** проверка `authorized_users` внутри `handleTelegramUpdate` до любого ответа.
- **System admin endpoints (`/v1/admin/*`)**: `Authorization: Bearer <SYNC_TOKEN>` (`auth.ts::checkBearer`). Используется для CSV-импорта и push references. Не используется в Stage 1 happy path.

### Input validation

- **POST /v1/expenses**: JSON парсится `await request.json().catch(() => null)`. Если не JSON или не объект — `400`. Поля не валидируются строго (Stage 1 — trust client; Stage 2 добавит валидацию).
- **Telegram bot text**: regex `/^(-?\d+(?:[.,]\d+)?)\s+([A-Za-z]{3,5})\s+(\S+)(?:\s+(.+))?$/`. Невалидное — отбой с подсказкой формата.
- **UUID `id`**: regex в роутинге `/^\/v1\/expenses\/([0-9a-fA-F-]+)$/` (минимум проверка формата для path).

### PII / финансовые данные

- В D1 хранятся: суммы трат, категории, описания (могут содержать «продукты», магазины, имена).
- Telegram ID владельца — PII (`docs/security.md`): в публичных доках только placeholder `<TELEGRAM_ID>`, реальное значение — в D1 `authorized_users`.
- `data/` (CSV-экспорт ОК) — gitignored.

### Что **не** должно попасть в логи

- `TELEGRAM_BOT_TOKEN` — в `wrangler secret`, не печатается.
- `SYNC_TOKEN` — то же.
- Содержимое `initData` (hash, user_id, auth_date) — не логируется (хотя в `unauthorized_attempt` пишется `user_id` нарушителя — это OK для аудита).
- В `unauthorized_attempt` логе: `text_preview` обрезан до 80 символов.

## 9. Acceptance criteria

- [x] **AC1**: `curl https://finances-worker.<owner>.workers.dev/healthz` → `200 {"ok":true}`.
- [x] **AC2**: `wrangler d1 execute finances-outbox --command="SELECT name FROM sqlite_master WHERE type='table'"` показывает: `authorized_users`, `accounts`, `categories`, `currencies`, `expenses`, `rates`, `snapshots`. Устаревшие (`expenses_outbox`, `device_heartbeats`, `expenses_cache`, `rate_limit`) — удалены (миграция 0004).
- [x] **AC3**: `wrangler d1 execute finances-outbox --command="SELECT * FROM authorized_users"` содержит как минимум одну строку (`telegram_id = '<TELEGRAM_ID>'`).
- [x] **AC4**: `@<bot_username>` подключён к Worker. `setWebhook` → `https://finances-worker.../tg` → 200. Стартовая команда `/start` от Stepan возвращает приветствие.
- [x] **AC5**: Non-whitelisted user пишет боту → **никакого ответа в чате**. В `wrangler tail` виден `unauthorized_attempt` с его `user_id`.
- [x] **AC6**: `setChatMenuButton` указывает на `https://finances-miniapp.pages.dev/`. В Telegram открывается Mini App.
- [x] **AC7**: Mini App при старте делает `GET /v1/bootstrap` → 200 с `accounts/categories/currencies/expenses`. State рендерится.
- [x] **AC8**: Прямой `curl GET /v1/bootstrap` без `X-Telegram-Init-Data` → `401 {"error":"unauthorized"}`.
- [x] **AC9**: GIVEN Mini App открыт WHEN тап на цифры «1850» + категория «food» THEN: (1) запись появляется в локальном `state.expenses`; (2) `POST /v1/expenses` возвращает 200; (3) `wrangler d1 execute --command="SELECT * FROM expenses ORDER BY created_at DESC LIMIT 1"` показывает только что созданную трату с `source='mini_app'`.
- [x] **AC10**: Повторный `POST /v1/expenses` с тем же `id` → `200 {"ok":true,"inserted":false}` (idempotency через `INSERT OR IGNORE`).
- [x] **AC11**: Bot text-fallback: Stepan пишет `50 EUR food продукты` → ответ `✅ Записано: 50 EUR / food`, в D1 — запись с `source='telegram_bot'`.
- [x] **AC12**: Smoke-test: реальная трата с iPhone в Telegram дошла до D1 (зафиксировано как закрытие Stage 1 в `docs/roadmap.md`).

## 10. Test plan

### Worker (manual / curl)

```bash
# health
curl -s https://finances-worker.<owner>.workers.dev/healthz
# → {"ok":true}

# bootstrap без auth → 401
curl -s -o - -w '%{http_code}\n' \
  https://finances-worker.<owner>.workers.dev/v1/bootstrap
# → 401

# bootstrap с настоящим initData (скопировать из DevTools при открытии Mini App)
curl -s -H "X-Telegram-Init-Data: <real initData>" \
  https://finances-worker.<owner>.workers.dev/v1/bootstrap
# → 200 + JSON
```

### D1 (sanity checks)

```bash
wrangler d1 execute finances-outbox --remote \
  --command="SELECT COUNT(*) FROM expenses WHERE source='mini_app'"

wrangler d1 execute finances-outbox --remote \
  --command="SELECT * FROM expenses ORDER BY created_at DESC LIMIT 5"
```

### Mini App (manual)

- Открыть бота в Telegram → нажать menu button → Mini App открывается без error toast.
- Ввести «1» + категория → toast «✓ ...», запись появляется в `recent-days`.
- Reload Mini App → запись осталась (значит реально записалась в D1, а не только в `state`).
- Открыть Mini App в браузере по прямому URL (без Telegram-обёртки) → ожидаемый bootstrap error.

### Telegram bot

- Whitelisted: `/start` → приветствие; `50 EUR food test` → запись.
- Non-whitelisted: создать тестовый аккаунт, написать что-то → молчание.
- `wrangler tail` показывает `unauthorized_attempt` для non-whitelisted.

### Regression

- Stage 0 docs — без изменений (Stage 1 их только дополняет).

## 11. Risks & open questions

- **R1**: Telegram webhook на free Worker может ловить bursts (1000 update'ов / sec при попытке fuzz). Митигейшен — silent policy (ADR-009): не отвечаем → не тратим лимит outbound `sendMessage`.
- **R2**: D1 free tier — 5 GB storage, 5M reads / 100k writes в день. Stage 1 не близко к лимитам (см. ADR-011), но при росте до multi-user — пересмотр.
- **R3**: `initData` подделать без `bot_token` невозможно (HMAC), но `bot_token` утечка = compromise. Митигейшен: `wrangler secret`, ротация при подозрении.
- **R4**: `INSERT OR IGNORE` тихий — клиент не отличает «реальный insert» от «дубль». Workaround: в response есть `inserted: boolean`.
- **OQ1**: ~~Нужен ли rate limit на `/v1/expenses`?~~ — отложено; в Stage 1 пользователь один (owner), угрозы DOS нет.
- **OQ2**: ~~Нужен ли CSRF для `/v1/expenses`?~~ — нет: `X-Telegram-Init-Data` сам по себе non-bearable из браузера-злоумышленника (нет cookie-auth).

## 12. Out of scope для review

- **OOS1**: `source='migration'` workflow (импорт CSV) — Stage 4.
- **OOS2**: Курсы валют, `rates` таблица (создаётся в 0005, не в Stage 1) — Stage 3.
- **OOS3**: Snapshots, accounts.form, sort_order, deleted_at в accounts/snapshots — миграция 0006, Stage 5.
- **OOS4**: Google OAuth, JWT, `/v1/web/*`, `/v1/auth/google/*` endpoints, `auth-google.ts`, `jwt.ts` — Stage 4 (Web Admin, ADR-012).
- **OOS5**: Имя D1 database `finances-outbox` (историческое, после ADR-011 уже не «outbox»). Переименование — отдельная задача.
- **OOS6**: Имя корневой папки `excel/` (не отражает текущий scope). См. roadmap, отдельный rename-task.

## 13. Changelog spec'а

- 2026-05-25: создан retrospectively (Stage 1 уже `done`). Описывает реализованное состояние по факту кода в `cloud/worker/` + `cloud/miniapp/` + миграциях `0001-0004`.
- 2026-05-25: статус `done`. Закрыто по факту smoke-теста (трата с iPhone → D1).
