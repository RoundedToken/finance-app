# Архитектура

## Цель
Personal finance system для одного пользователя, без VPS/подписок, под полным контролем разработчика-владельца. **D1 (Cloudflare SQLite) — единственный источник правды**, MacBook — только daily backup. Два клиентских канала:

- **Mini App в Telegram** — ввод расходов с iPhone + быстрая аналитика (закрытый scope).
- **Web Admin (React SPA)** — снапшоты, доходы, обмены, дашборды, портфель (растущий scope).

См. ADR-011 (D1-centric pivot) и ADR-012 (Web Admin как второй канал).

## Контекст и ограничения
- **Один пользователь** (Stepan), один MacBook, один iPhone.
- MacBook **не всегда онлайн** (закрыт, в сумке, в дороге).
- iPhone **почти всегда онлайн** через сотовую сеть / Wi-Fi.
- **Без VPS** и без месячных подписок — категорическое требование.
- **Без App Store** — никакого native iOS-приложения, никакого Developer Account за $99/год.
- Финансовые данные **приватные** — никаких сторонних SaaS-агрегаторов, никаких open analytics.
- **Несколько валют одновременно**: EUR, USD, RUB, RSD, USDT. Курсы фиксируются на момент операции.
- **Эволюция функциональности**: начинаем с расходов, добавляем снапшоты/обмены/инвестиции по мере роста.

## Высокоуровневая диаграмма (после ADR-011 + ADR-012)

```
┌──────────────────────────┐    ┌───────────────────────────┐
│   iPhone — Telegram      │    │   Desktop browser         │
│  ┌────────────────────┐  │    │  ┌─────────────────────┐  │
│  │ Mini App           │  │    │  │ Web Admin (React)   │  │
│  │ - numpad + cats    │  │    │  │ - accounts          │  │
│  │ - история          │  │    │  │ - snapshots         │  │
│  │ - 📊 статистика     │  │    │  │ - incomes / chains  │  │
│  │ - settings         │  │    │  │ - dashboards        │  │
│  └──────────┬─────────┘  │    │  └──────────┬──────────┘  │
└─────────────┼────────────┘    └─────────────┼─────────────┘
              │ initData auth                 │ Bearer JWT
              │ HTTPS                         │ HTTPS
              ▼                               ▼
        ┌─────────────────────────────────────────────────┐
        │     Cloudflare edge (serverless, free)          │
        │  ┌───────────────────────────────────────────┐  │
        │  │ Worker (TypeScript)                       │  │
        │  │  - /tg                webhook Telegram    │  │
        │  │  - /v1/auth/google/*  OAuth flow          │  │
        │  │  - /v1/expenses/...   Mini App CRUD       │  │
        │  │  - /v1/admin/...      Web Admin CRUD      │  │
        │  │  - /v1/rates/...      курсы               │  │
        │  │  - cron               daily rates pull    │  │
        │  └──────────────────┬────────────────────────┘  │
        │  ┌──────────────────▼────────────────────────┐  │
        │  │ D1 — ИСТОЧНИК ПРАВДЫ                      │  │
        │  │  expenses, categories, accounts,          │  │
        │  │  currencies, rates, authorized_users,     │  │
        │  │  snapshots (planned), transactions ...    │  │
        │  └───────────────────────────────────────────┘  │
        │  ┌─────────────────┐    ┌─────────────────────┐ │
        │  │ Pages           │    │ Pages               │ │
        │  │ finances-miniapp│    │ finances-admin      │ │
        │  │ (Mini App SPA)  │    │ (Web Admin SPA)     │ │
        │  └─────────────────┘    └─────────────────────┘ │
        └────────────────────────┬────────────────────────┘
                                 │ wrangler d1 export (daily)
                                 ▼
                ┌─────────────────────────────────┐
                │   MacBook — daily backup only   │
                │  local/scripts/backup_d1.py     │
                │  → finances.db.<ts>.sql         │
                │  → iCloud Drive copy            │
                └─────────────────────────────────┘
```

**Ключевое отличие от исходной архитектуры:** MacBook сведён к роли backup-узла. Mini App пишет напрямую в D1 (нет outbox/cleanup), Web Admin — тоже напрямую. Аналитика и дашборды живут в Web Admin, не в Excel.

## Потоки данных

### Поток 1: запись расхода с iPhone (Mini App)
1. Пользователь открывает Mini App в Telegram.
2. Тапает категорию → набирает сумму → подтверждает.
3. Mini App генерирует **UUID** в браузере и шлёт `POST /v1/expenses` на Worker.
4. Worker валидирует Telegram `initData`-подпись, пишет напрямую в D1 (`INSERT OR IGNORE`).
5. Mini App получает 200 OK.

Если связь пропала — Mini App кэширует в `localStorage` и повторяет при появлении сети. UUID не меняется → идемпотентно (ADR-005).

### Поток 2: вход в Web Admin (Google OAuth)
1. Пользователь открывает `https://finances-admin.pages.dev/`.
2. SPA проверяет JWT в `localStorage`. Если нет — рендерит `/login` с кнопкой «Sign in with Google».
3. Клик → редирект на `<worker>/v1/auth/google/start?return_to=<spa-url>`.
4. Worker генерит state-nonce, ставит state-cookie, редиректит на Google `accounts.google.com/o/oauth2/v2/auth?...&scope=openid%20email`.
5. Google → callback `<worker>/v1/auth/google/callback?code=...&state=...`.
6. Worker exchange `code` на `id_token`, проверяет email против allowlist в `ADMIN_ALLOWED_EMAILS`.
7. Если ОК — Worker генерит JWT HS256 (`sub=email`, `exp=now+30d`), редиректит на `<spa-url>#token=<jwt>`.
8. SPA достаёт token из URL fragment, сохраняет в `localStorage`, чистит URL.

### Поток 3: CRUD из Web Admin
1. SPA делает `fetch('/v1/admin/<resource>', { headers: { Authorization: 'Bearer ' + token } })`.
2. Worker middleware `requireAdmin` валидирует JWT (HS256, проверка `exp`, проверка `sub` в allowlist).
3. Если ОК — handler работает с D1 напрямую.
4. Если 401 — SPA чистит token и показывает /login.

### Поток 4: курсы валют (cron)
1. Cloudflare Cron Trigger срабатывает раз в сутки.
2. Worker делает `fetch(GOOGLE_RATES_LATEST_CSV)`, парсит CSV (см. ADR-006).
3. `INSERT OR REPLACE INTO rates (date, base, quote, rate)` для каждой валюты.
4. Mini App и Web Admin читают актуальные курсы из D1 при bootstrap.

### Поток 5: backup MacBook (раз в день)
1. launchd-агент запускает `local/scripts/backup_d1.py`.
2. Скрипт делает `wrangler d1 export finances-outbox --output=local/backups/d1-<ts>.sql`.
3. Копирует в iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/finances-backups/`).
4. Старые backup'ы старше 30 дней — удаляются.

## Безопасность

### Два независимых auth-канала

| Канал | Метод | Где валидируется |
|---|---|---|
| Mini App | Telegram `initData` HMAC | Worker через bot token |
| Web Admin | Google OAuth → JWT HS256 | Worker через `ADMIN_JWT_SECRET` |

### Конкретики

1. **Telegram authorization**: Worker валидирует `initData` от Mini App с использованием HMAC от bot token. Гарантирует, что запрос пришёл из настоящего Telegram Mini App.
2. **Telegram whitelist**: только `telegram_id` из таблицы `authorized_users` D1. По умолчанию там только владелец.
3. **Google OAuth для Web Admin**: проверяется `id_token`-`email` против allowlist `ADMIN_ALLOWED_EMAILS` (CSV-список, конфигурируется в wrangler vars). Audience = свой `GOOGLE_CLIENT_ID`.
4. **JWT для сессий Web Admin**: HS256, секрет в `ADMIN_JWT_SECRET` (wrangler secret), `exp = 30d`, `sub = email`. Передаётся в `Authorization: Bearer ...` header.
5. **CORS**: Worker отвечает с `Access-Control-Allow-Origin: https://<pages>.pages.dev` для конкретного domain. Pre-flight `OPTIONS` обрабатывается.
6. **Секреты**:
   - В облаке — `wrangler secret put TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_SECRET`, `ADMIN_JWT_SECRET`.
   - Локально — `.env` (в `.gitignore`).
   - GCP Service Account JSON для Sheets — `~/.config/finances-gsheets/key.json`, никогда в репо.
7. **Token storage в SPA**: JWT в `localStorage`. Защищено CSP (`default-src 'self'`), нет user-generated content, нет внешних inline-скриптов.
8. **Rate limiting**: на уровне Worker — простой counter в D1 (max 60 req/min per user).

## Отказоустойчивость

| Что может сломаться | Что происходит |
|---|---|
| iPhone офлайн при вводе | Mini App кэширует в `localStorage`, повторяет при сети |
| MacBook офлайн неделями | D1 хранит 7 дней — рискуем потерять старше. Расширить cleanup до 30 дней. |
| Cloudflare Worker лёг | Mini App кэширует, повторяет |
| D1 лёг (редко) | Mini App вернёт ошибку, попросит повторить позже |
| Локальный SQLite поломан | Восстанавливаем из `local/backups/finances.<ts>.db` |
| Excel-файл повреждён | Регенерируем из SQLite — это автогенерируемый артефакт |

**Единственное, что нельзя восстановить, — это локальный SQLite, если потеряются и он, и D1.** Поэтому: ежедневный backup `finances.db` в `~/Library/Mobile Documents/com~apple~CloudDocs/finances-backups/` (iCloud Drive) через `cron` или launchd.

## Что НЕ делает архитектура (и не должна)
- Не агрегирует данные нескольких пользователей.
- Не делает realtime push (free Cloudflare без WebSocket / Durable Objects).
- Не интегрируется с банковскими API.
- Не считает налоги.
- Не присылает SMS-уведомления.

## Эволюция

См. `docs/roadmap.md` для актуального состояния. Кратко:
- **Stage 0-2**: инфра + Mini App MVP (закрыто).
- **Stage 3**: курсы валют + аналитика в Mini App (закрыто).
- **Stage 4**: **Web Admin Bootstrap** — Google OAuth + read-only expenses (в работе).
- **Stage 5+**: снапшоты, доходы, обмены, дашборды, инвестиции — всё в Web Admin.
