# Архитектура

## Цель
Personal finance system для одного пользователя, без VPS/подписок, под полным контролем разработчика-владельца. **D1 (Cloudflare SQLite) — единственный источник правды**, MacBook — только daily backup. Два клиентских канала:

- **Mini App в Telegram** — ввод расходов с iPhone + read-only аналитика расходов (экран «📊 Статистика», ADR-021/SPEC-036); глубокая аналитика — в Web Admin, см. CLAUDE.md правило 11.
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
│  │ - 📊 статистика     │  │    │  │ - incomes / goals   │  │
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
        │  │  - /v1/web/*          Web Admin CRUD (JWT)│  │
        │  │  - /v1/admin/*        sys-миграции (SYNC) │  │
        │  │  - /v1/rates/...      курсы               │  │
        │  │  - cron    rates 4×/сутки + coach 1×/день │  │
        │  └──────────────────┬────────────────────────┘  │
        │  ┌──────────────────▼────────────────────────┐  │
        │  │ D1 — ИСТОЧНИК ПРАВДЫ                      │  │
        │  │  expenses, categories, accounts,          │  │
        │  │  currencies, rates, authorized_users,     │  │
        │  │  snapshots, transactions, goals, budgets, │  │
        │  │  rate_ticks, coach_state ...              │  │
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

### Поток 4: cron (курсы + Lido APR + coach)

Два Cron Trigger'а (`triggers.crons` в wrangler.toml), ветвление по `event.cron` в `scheduled()`:

**A. Курсы — 4×/сутки (`0 */6 * * *`):**
1. **Фиат** (EUR/USD/RUB/RSD/USDT/TRY): Worker делает `fetch(GOOGLE_RATES_LATEST_CSV)`, парсит CSV (см. ADR-006).
2. **Крипто** (ETH/EUR): цепочка провайдеров Binance→Coinbase→CoinGecko (fallback при гео-блоке CF-IP, ADR-019/SPEC-028) — отдельный try/catch, падение не валит фиат.
3. `INSERT OR REPLACE INTO rates (date, base, quote, rate)` для каждой валюты; крипто пишет ещё и внутридневной тик в `rate_ticks`.
4. **Lido APR** (SPEC-027): fetch авто-APR stETH → `app_config.steth_apr_pct` (тоже изолированный try/catch).
5. Mini App и Web Admin читают актуальные курсы из D1 при bootstrap.

**B. Coach-нудж — 1×/день (`0 7 * * *`, `COACH_CRON`, SPEC-040/ADR-023):** детерминированные правила качества данных (`coach.ts`); при наличии сигналов — одно Telegram-сообщение владельцу через бота; cooldown в `coach_state`. Нет сигналов → молчание.

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
7. **Token storage в SPA**: JWT в `localStorage` Web Admin. Защищено CSP (`cloud/admin/public/_headers`: `default-src 'self'`, нет inline/eval). Mini App JWT не хранит (auth — `initData` HMAC в header).
8. **Rate limiting**: не реализован — осознанный non-goal для single-user (атаковать некому, оба канала за auth-проверкой). Не вводить без реальной потребности.

## Отказоустойчивость

**Источник правды — Cloudflare D1** (ADR-011). Других полных копий «в живую» нет; локального SQLite-ground-truth не существует. Защита — ежедневный экспорт D1.

| Что может сломаться | Что происходит |
|---|---|
| iPhone офлайн при вводе | Mini App кэширует в `localStorage`, повторяет при сети (UUID → идемпотентно) |
| Cloudflare Worker лёг | Mini App кэширует и повторяет; Web Admin покажет ошибку |
| D1 деградировал (редко) | клиент вернёт ошибку, попросит повторить позже |
| Аккаунт Cloudflare / D1 потерян | восстановление из последнего daily-дампа (потеря ≤ 1 день) |

**Модель восстановления.** Две линии защиты:
1. **D1 Time Travel** (встроенный в Cloudflare, ничего настраивать не надо) — point-in-time restore на любой момент последних **30 дней**: `wrangler d1 time-travel info finances-outbox` (текущий bookmark) → `wrangler d1 time-travel restore finances-outbox --timestamp=<unix|ISO>`. Первая линия при любом «испортили данные / кривая миграция»: работает даже если MacBook выключен неделями.
2. **Daily-дамп на MacBook** — `local/scripts/backup_d1.py` (launchd `com.user.finance-backup`, ежедневно в 10:30 + при загрузке агента): `wrangler d1 export` → `local/backups/d1-<ts>.sql`, verify-фаза (импорт в temp-sqlite, count ключевых таблиц, size-drop guard) + копия в iCloud Drive. Защищает от потери самого аккаунта Cloudflare / горизонта >30 дней. Восстановление: пересоздать D1 + импортировать последний `.sql`-дамп (процедура — волна 0.4 аудита 2026-07, DB-06). Максимальная потеря — операции за неполные сутки с последнего бэкапа.

## Что НЕ делает архитектура (и не должна)
- Не агрегирует данные нескольких пользователей.
- Не делает realtime push (free Cloudflare без WebSocket / Durable Objects).
- Не интегрируется с банковскими API.
- Не считает налоги.
- Не присылает SMS-уведомления.
- **Не позволяет вводить доход / снапшот / обмен с телефона** — это только Web Admin (десктоп). Осознанный текущий non-goal; лёгкий путь через text-команду бота — план post-MVP (см. roadmap).

## Эволюция

См. `docs/roadmap.md` и `docs/post-mvp-roadmap.md` для актуального состояния. Кратко (всё ниже — на проде):
- **Stage 0-2**: инфра + Mini App MVP (закрыто).
- **Stage 3**: курсы валют + аналитика в Mini App (закрыто).
- **Stage 4**: **Web Admin Bootstrap** — Google OAuth + read-only expenses (закрыто).
- **Stage 5-8**: снапшоты, доходы, обмены, цели, дашборды — всё в Web Admin (закрыто).
- **MVP финализирован 2026-05-29**, дальше post-MVP (на проде): бюджеты (SPEC-020/023), инвестиции/крипто-портфель (Stage 9 — SPEC-026…030), виртуализация списков (SPEC-034), статистика Mini App (SPEC-036). Открыто: AI Coach (Stage 10), мобильный ввод дохода/снапшота, график прогресса цели.
