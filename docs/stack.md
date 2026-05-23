# Технологический стек

Все технологии с версиями, ролями и обоснованием.

## Языки и рантаймы

| Компонент | Версия | Где используется |
|---|---|---|
| Python | 3.13 | Локальные скрипты (sync, regenerate, init_db), CLI-инструменты |
| TypeScript | ~5.6 | Cloudflare Worker |
| Node.js | 20+ | Деплой воркера через wrangler |
| HTML/CSS/JS (ES2023) | — | Telegram Mini App |
| SQL (SQLite dialect) | — | local/migrations/, cloud/worker/schema.sql |

**Системный Python 3.9.6 — не использовать.** Только Python 3.13 из brew.

## Python-зависимости (`requirements.txt`)

| Пакет | Версия | Зачем |
|---|---|---|
| `openpyxl` | `>=3.1.5,<4` | Чтение/правка существующих .xlsx (Legacy + Excel-tools) |
| `xlsxwriter` | `>=3.2.9,<4` | Генерация дашборда `Finances.xlsx` с нуля (форматирование, графики) |
| `python-calamine` | `>=0.2` | Быстрый ридер xlsx для миграций |
| `xlcalculator` | `>=0.5` | Верификация формул без LibreOffice |
| `lxml` | `>=5` | XML-парсинг внутренностей .xlsx |
| `pandas` | `>=2.2` | Аналитика, агрегации, миграция Legacy |
| `requests` | `>=2.31` | REST-вызовы к Cloudflare Worker |
| `httpx` | `>=0.27` | Альтернатива requests, async когда понадобится |
| `click` | `>=8.1` | CLI-фреймворк для add_*.py скриптов |
| `rich` | `>=13` | Цветной вывод, прогресс-бары |
| `python-dotenv` | `>=1.0` | Загрузка `.env` |

Стандартная библиотека: `sqlite3`, `uuid`, `json`, `csv`, `zipfile`, `xml.etree`, `datetime`, `subprocess`.

## TypeScript / Node зависимости

`cloud/worker/package.json`:

| Пакет | Версия | Зачем |
|---|---|---|
| `wrangler` | ^3 | Cloudflare deploy tool |
| `@cloudflare/workers-types` | latest | TS-типы для Workers API |
| `typescript` | ^5 | компилятор |
| `hono` | ^4 | (опционально) lightweight router для Worker — без него тоже можно |
| `@cloudflare/d1` | — | D1 client встроен в Workers API |

В Mini App пока без бандлера — обычный HTML + ES modules. Если код вырастет — добавим Vite или esbuild.

## Облачные сервисы

| Сервис | Тариф | Лимит | Реальная нагрузка |
|---|---|---|---|
| Cloudflare Workers | Free | 100k req/day | ~50/день |
| Cloudflare D1 | Free | 5 GB storage, 5M reads/day, 100k writes/day | ~30 writes/день, ~5 reads/день |
| Cloudflare Pages | Free | unlimited bandwidth, 500 deploys/мес | 1-2 deploy/мес |
| Cloudflare Cron Triggers | Free | 1000 invocations/day | 1/день |
| Telegram Bot API | Free | без лимитов для personal | ~50 msg/день |
| Telegram Mini Apps | Free | без лимитов | — |
| Google Sheets | Free | 5M cells per sheet | ~10 ячеек |

## Локальные сервисы

| Сервис | Назначение |
|---|---|
| SQLite (через `sqlite3` модуль) | Локальный ground truth |
| launchd | Запуск sync по расписанию / при login |
| iCloud Drive | Бэкап `finances.db` |
| LibreOffice (опционально) | Пересчёт формул в Legacy .xlsx через `soffice --headless` |
| visidata, miller, csvkit (опционально) | TUI просмотр и обработка CSV |

## Структура зависимостей между компонентами

```
                       Telegram
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
   Mini App (HTML/JS) <- Bot <- @BotFather config
            │             │
            └──────┬──────┘
                   ▼
            Cloudflare Worker (TS)
                   ▼
            Cloudflare D1 (SQLite)
                   ▼
   ┌───────────────┼───────────────┐
   │               │               │
   ▼               ▼               ▼
sync.py     regenerate_xlsx.py  fetch_rates.py
   │               │               │
   ▼               ▼               ▼
finances.db <─── reads ──── Google Sheets (CSV)
   │
   ▼
Finances.xlsx
```

## Инструменты разработки

| Инструмент | Назначение |
|---|---|
| `git` | Версионирование (репозиторий локальный, опционально GitHub) |
| `wrangler` | Деплой и dev-сервер Worker'а |
| `wrangler tail` | Live-логи Worker'а |
| `wrangler d1 execute` | SQL в D1 для дебага |
| `sqlite3` CLI | Просмотр локальной БД |
| `python -i` | Интерактивный REPL для отладки |
| `gh` | GitHub CLI (если когда-то запушим репо) |

## Что НЕ используется

Список технологий, которые сознательно отвергнуты — для прозрачности и чтобы не возвращаться к этим спорам:

- **PostgreSQL / MySQL** — overkill для personal scale.
- **Redis / Memcached** — нет потребности в кэше.
- **Docker** — деплой через wrangler, локально venv хватает.
- **Kubernetes** — нонсенс для personal.
- **GraphQL** — REST хватает с лихвой.
- **React / Vue / Angular** для Mini App — пока хватает vanilla. Vite + Preact если UI вырастет.
- **gRPC** — нет.
- **FastAPI / Flask на MacBook** — MacBook не сервер.
- **Firebase** — vendor lock-in, политически рискованно для RU-данных.
- **Supabase** — оверкилл (full Postgres + auth + storage), мы только outbox-буфер.
- **AWS / GCP / Azure** — платно и сложно для personal.
- **VPS любые** — категорическое НЕТ от пользователя.
- **iCloud KVS / CloudKit** — требует native iOS app (App Store).
- **Apple Shortcuts как ввод** — UI ограничен.
- **PWA на iOS** — IndexedDB ненадёжен на iOS, отсутствие нативного feel.

## Версии — заморозка

Версии в `requirements.txt` и `package.json` зафиксированы диапазонами `>=X.Y,<X+1`. Обновляться по необходимости через:
```bash
pip install --upgrade -r requirements.txt
npm update
```

После major-обновления — прогнать smoke-test (`docs/setup.md → Проверочный smoke-test`).
