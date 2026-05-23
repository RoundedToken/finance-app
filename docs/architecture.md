# Архитектура

## Цель
Personal finance system для одного пользователя с офлайн-first вводом расходов с iPhone, без VPS/подписок, под полным контролем разработчика-владельца. Источник правды — локальный SQLite. Excel — производный дашборд. Telegram — единственный канал ввода с телефона.

## Контекст и ограничения
- **Один пользователь** (Stepan), один MacBook, один iPhone.
- MacBook **не всегда онлайн** (закрыт, в сумке, в дороге).
- iPhone **почти всегда онлайн** через сотовую сеть / Wi-Fi.
- **Без VPS** и без месячных подписок — категорическое требование.
- **Без App Store** — никакого native iOS-приложения, никакого Developer Account за $99/год.
- Финансовые данные **приватные** — никаких сторонних SaaS-агрегаторов, никаких open analytics.
- **Несколько валют одновременно**: EUR, USD, RUB, RSD, USDT. Курсы фиксируются на момент операции.
- **Эволюция функциональности**: начинаем с расходов, добавляем снапшоты/обмены/инвестиции по мере роста.

## Высокоуровневая диаграмма

```
┌──────────────────────────────────────────────┐
│           iPhone — Telegram client           │
│  ┌────────────────────────────────────────┐  │
│  │  Mini App (HTML/JS)                    │  │
│  │  UI: сетка категорий, num pad, графики │  │
│  └──────────────┬─────────────────────────┘  │
└─────────────────┼──────────────────────────────┘
                  │ HTTPS (Telegram WebApp API + REST)
                  ▼
┌──────────────────────────────────────────────┐
│        Cloudflare edge (serverless, free)    │
│  ┌────────────────────────────────────────┐  │
│  │ Worker:                                │  │
│  │  - webhook /tg — Telegram bot          │  │
│  │  - api /v1/expenses, /v1/sync          │  │
│  │  - cron — раз в сутки чистит outbox    │  │
│  └──────────────┬─────────────────────────┘  │
│  ┌──────────────▼─────────────────────────┐  │
│  │ D1 (SQLite в облаке) — outbox/buffer   │  │
│  │  - expenses_outbox                     │  │
│  │  - accounts, categories (read-only-ish)│  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ Pages — статика для Mini App           │  │
│  └────────────────────────────────────────┘  │
└────────────────┬─────────────────────────────┘
                 │ REST API (GET /v1/sync?since=...,
                 │           POST /v1/sync/confirm)
                 ▼  (запускается launchd при пробуждении)
┌──────────────────────────────────────────────┐
│              MacBook (не всегда онлайн)       │
│  ┌────────────────────────────────────────┐  │
│  │ local/scripts/sync.py                  │  │
│  │  1. fetch new from D1                  │  │
│  │  2. insert into local SQLite           │  │
│  │  3. confirm UUIDs back to D1           │  │
│  │  4. regenerate Finances.xlsx           │  │
│  │  5. notify (macOS notification)        │  │
│  └──────────────┬─────────────────────────┘  │
│  ┌──────────────▼─────────────────────────┐  │
│  │ local/finances.db                      │  │
│  │ ИСТОЧНИК ПРАВДЫ                        │  │
│  │  - expenses (полная история)           │  │
│  │  - transactions, snapshots, rates...   │  │
│  └──────────────┬─────────────────────────┘  │
│  ┌──────────────▼─────────────────────────┐  │
│  │ reports/Finances.generated.xlsx                 │  │
│  │ Read-only dashboard                    │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## Потоки данных

### Поток 1: запись расхода с iPhone
1. Пользователь открывает Mini App в Telegram.
2. Тапает категорию → набирает сумму → подтверждает.
3. Mini App генерирует **UUID** в браузере и шлёт `POST /v1/expenses` на Worker.
4. Worker валидирует (Telegram-инициатива через `initData`-подпись), пишет в `expenses_outbox` D1.
5. Mini App получает 200 OK, показывает «✓ записано».

Если связь пропала между шагами 3 и 4 — Mini App кэширует в `localStorage` и повторяет при появлении сети. UUID не меняется → идемпотентно.

### Триггеры sync

MacBook не имеет публичного endpoint'а (за NAT, без VPS), поэтому **push с Worker'а напрямую невозможен**. Используется **pull-режим**: MacBook сам опрашивает D1.

**Три триггера запуска `sync.py`:**

1. **launchd-агент `com.user.excel-sync.plist`** — `StartInterval = 60` сек.
   Запускает `sync.py --once --quiet` каждую минуту, когда MacBook не спит. `RunAtLoad=true` гарантирует пуск сразу после login.
2. **Пользователь явно нажал `/sync` в боте.**
   Команда возвращает текущий outbox-status + heartbeat. Это не "push to MacBook", а информационный запрос. Так как launchd опрашивает раз в минуту, max ожидание ≤ 60 секунд.
3. **Кнопка «🔄 Sync now» в Mini App** (Этап 2).
   Делает то же самое: показывает статус и количество ожидающих записей.

**Heartbeat-механизм:**
- При каждом `sync.py` MacBook посылает heartbeat в D1 (`POST /v1/sync/heartbeat`).
- Bot и Mini App читают `GET /v1/sync/status`: видят `last_seen` MacBook, outbox-counters, последнюю ошибку.
- Пользователь всегда видит честную картину: «MacBook был онлайн 30s назад, в outbox 3 ожидают».

### Поток 2: синхронизация MacBook → локальный SQLite
1. macOS просыпается / пользователь логинится.
2. `launchd`-агент `com.user.excel-sync.plist` запускает `local/scripts/sync.py`.
3. Скрипт читает `local/sync_state` — последний `synced_at` timestamp.
4. `GET /v1/sync?since=<timestamp>` к Worker — получает новые expenses (JSON массив).
5. В одной транзакции SQLite: `INSERT OR IGNORE INTO expenses ...` по UUID.
6. После commit: `POST /v1/sync/confirm {ids: [...]}` → Worker помечает `synced_at = now()` в D1.
7. Обновляет `local/sync_state` с новым timestamp.
8. Запускает `regenerate_xlsx.py` — перестраивает `Finances.xlsx`.
9. macOS notification: «Sync: +N трат, баланс XXX EUR».

### Поток 3: cron-очистка D1
1. Cloudflare Cron Trigger срабатывает раз в сутки (например, 03:00 UTC).
2. Worker выполняет `DELETE FROM expenses_outbox WHERE synced_at IS NOT NULL AND synced_at < datetime('now', '-7 days')`.
3. Логирует в Worker logs сколько удалено.

### Поток 4: ручной ввод снапшота/обмена с MacBook
1. Открыть терминал, активировать venv.
2. `python local/scripts/add_snapshot.py` или `add_transaction.py` — интерактивный TUI с автодополнением аккаунтов/валют.
3. Пишет напрямую в локальный SQLite.
4. Регенерирует Excel.

Снапшоты и обмены **тоже** можно ввести с iPhone позже — когда расширим Mini App. Но это не Этап 1.

### Поток 5: курсы валют
1. Пользователь однажды настраивает Google Sheet с `=GOOGLEFINANCE("CURRENCY:USDEUR")` для всех нужных пар.
2. Публикует sheet как CSV (Share → Publish to web).
3. `local/scripts/fetch_rates.py` читает CSV → пишет в `rates` таблицу.
4. Запускается раз в день launchd-агентом или внутри `sync.py`.

## Безопасность

1. **Telegram authorization**: Worker валидирует `initData` от Mini App с использованием `WEBAPP_SECRET` (HMAC от bot token). Это гарантирует, что запрос пришёл из настоящего Telegram Mini App, а не curl.
2. **Whitelist users**: только telegram_id из таблицы `authorized_users` D1 может писать. По умолчанию там только владелец.
3. **Секреты**: bot token + cloudflare API token хранятся:
   - В облаке — `wrangler secret put TELEGRAM_BOT_TOKEN`
   - Локально — `.env` (в `.gitignore`)
4. **CORS**: Worker отвечает с `Access-Control-Allow-Origin: https://<mini-app>.pages.dev` строго.
5. **Rate limiting**: на уровне Worker — простой counter в D1 (например, max 60 expenses/min per user).

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
- Не делает realtime push на MacBook (только pull при пробуждении).
- Не интегрируется с банковскими API.
- Не считает налоги.
- Не присылает SMS-уведомления.

## Эволюция
- **Этап 1**: только расходы через Mini App, текст-only Telegram bot для bootstrap.
- **Этап 2**: красивый UI Mini App (категории как сетка с эмодзи, как в «Расходах ОК»).
- **Этап 3**: миграция CSV из «Расходы ОК».
- **Этап 4**: снапшоты и обмены через Mini App.
- **Этап 5**: инвестиции (вклады с %, USDT Earn, ETF когда появятся).
- **Этап 6**: полноценный Dashboard с графиками.

См. `docs/roadmap.md` для актуального состояния.
