# Excel — Personal Finance System

Полная личная финансовая система:
**Telegram Mini App → Cloudflare Workers → локальный SQLite → Excel-дашборд.**

## TL;DR для агента
- **Локальный SQLite** в `local/finances.db` — **единственный источник правды**.
- **Cloudflare D1** — транзитный буфер ("outbox"). Чистится после sync через 7 дней.
- **`Finances.xlsx`** — read-only dashboard, регенерируется из SQLite.
- **Mini App + Worker** на Cloudflare — бесплатный serverless, **не VPS**.
- **MacBook не всегда онлайн.** При пробуждении `launchd` запускает `local/scripts/sync.py`.

## Текущий этап
Этап 0 (инфраструктура и скелет). Дальше — см. `docs/roadmap.md`.

## Структура репозитория

```
excel/                            # имя корня — historical; см. ADR-011 о возможном переименовании
├── CLAUDE.md, README.md          ← entry points
├── docs/                         ← вся архитектурная документация
│   ├── architecture.md           — общая архитектура и диаграммы
│   ├── data-model.md             — SQLite-схемы (local и D1)
│   ├── sync-protocol.md          — как идёт sync, идемпотентность, cleanup
│   ├── decisions.md              — ADR: почему такие решения
│   ├── setup.md                  — как поднять проект с нуля
│   ├── stack.md                  — технологический стек
│   └── roadmap.md                — план этапов и текущий статус
├── data/                         ← source data (личные, gitignored — только README в git)
│   ├── README.md
│   ├── legacy/                   — Finances.xlsx (старый ground truth) + бэкапы
│   └── money-ok/                 — CSV-экспорт из «Расходы ОК» + скриншоты UI
├── local/                        ← локальный SQLite (ground truth) + sync + регенерация
│   ├── schema.sql                — DDL (current snapshot)
│   ├── migrations/               — нумерованные миграции схемы
│   ├── launchd/                  — plist для автозапуска sync.py
│   ├── scripts/
│   │   ├── init_db.py            — создать БД, применить миграции
│   │   ├── sync.py               — тянуть из D1, писать локально, heartbeat
│   │   └── regenerate_xlsx.py    — собрать reports/Finances.generated.xlsx
│   ├── backups/                  — копии finances.db
│   └── logs/                     — sync.out.log, sync.err.log
├── cloud/                        ← Cloudflare Worker + Mini App
│   ├── worker/                   — TypeScript, REST API + Telegram bot + cron
│   │   ├── src/                  — index.ts, bot.ts, auth.ts, db.ts, types.ts
│   │   ├── schema.sql, migrations/
│   │   ├── scripts/bootstrap.sh
│   │   └── wrangler.toml, package.json
│   └── miniapp/                  — Telegram Mini App (HTML/CSS/JS)
│       └── public/
├── tools/                        ← Excel-инструменты (Legacy и отладка дашборда)
│   ├── README.md, CLAUDE.md
│   ├── Makefile
│   └── excel/                    — 12 утилит для .xlsx (inspect_xlsx, backup, diff, ...)
└── reports/                      ← generated artefacts (Finances.generated.xlsx) — gitignored
```

**Историческая заметка**: корень папки называется `excel/`, что не отражает текущий scope (полноценная финансовая система с Telegram-каналом ввода). Переименовать — отдельная задача, потребует обновить пути в `launchd`-агенте и `.env`. См. roadmap.

## Главные правила для агента

1. **Excel не источник правды.** `Finances.xlsx` — это generated view из локального SQLite. Никогда не редактировать данные напрямую в .xlsx для бизнес-целей. Если нужно поменять цифру — менять в SQLite (или через скрипт правки), и регенерировать Excel.

2. **Схема SQLite меняется только через миграции.**
   `local/migrations/` — нумерованные SQL-файлы (`001_init.sql`, `002_add_chains.sql`...). Никогда не редактировать существующую миграцию — только добавлять новую. `schema.sql` обновляется параллельно как «текущий снапшот».

3. **D1 (облако) — буфер, не архив.**
   Cron-задача в Cloudflare Worker раз в сутки чистит `expenses_outbox WHERE synced_at < now() - 7 days`. Никогда не хранить там историческое.

4. **Cloudflare деплой — только через wrangler.**
   Не править Worker/D1 через веб-дашборд CF. Все изменения — через `cloud/worker/wrangler.toml` + git.

5. **Секреты — в `wrangler secret` (для облака) и `.env` (локально).**
   Telegram bot token, Cloudflare API tokens — никогда не в коде и не в git.

6. **Идемпотентность sync — обязательна.**
   Каждая запись имеет UUID (генерится на клиенте). Локальный `INSERT OR IGNORE` по UUID. Повторный sync безопасен.

7. **Перед миграцией данных — backup локальной БД.**
   `cp local/finances.db local/backups/finances.<ts>.db`. Аналогично — перед сложными правками в Worker.

8. **macOS-specific:**
   - Python 3.13 в `.venv/` корня проекта. **Не использовать системный Python 3.9.6.**
   - Node + npm для wrangler. Wrangler ставится глобально (`npm install -g wrangler`).
   - launchd-агент для sync прописывается в `~/Library/LaunchAgents/com.user.excel-sync.plist` (см. `local/README.md`).

9. **При работе с Legacy `data/legacy/Finances.xlsx` — соблюдать правила из `tools/CLAUDE.md`** (atomic save, backup в `data/legacy/backups/`, roundtrip-check). Excel хрупкий, особенно chart/form controls/calcChain.

10. **Когда непонятно direction — спросить пользователя.** Не угадывать архитектурные решения.

11. **Bot не отвечает никому, кроме `authorized_users`.** Это правило безопасности (`docs/decisions.md` ADR-009). Не добавлять «фолбэк-приветствия» для unauthorized — только логирование в Worker logs. Для добавления нового пользователя — `wrangler d1 execute INSERT INTO authorized_users` (см. `docs/setup.md`).

## Где что искать

| Вопрос | Файл |
|---|---|
| Общая архитектура, диаграмма потоков | `docs/architecture.md` |
| Какие таблицы и поля в SQLite | `docs/data-model.md` |
| Как именно работает sync iPhone → MacBook | `docs/sync-protocol.md` |
| Почему выбрали Cloudflare/SQLite/Telegram | `docs/decisions.md` |
| Как поднять проект с нуля | `docs/setup.md` |
| Полный список зависимостей и версий | `docs/stack.md` |
| Что сейчас делаем, что дальше | `docs/roadmap.md` |
| Excel-инспекция (legacy lens + dashboard debug) | `tools/CLAUDE.md` |
| Source data (CSV/скрины/Legacy xlsx) | `data/README.md` |
| Regenerated artefacts | `reports/README.md` |
| Локальный SQLite + sync | `local/README.md` |
| Cloudflare Worker + Mini App | `cloud/README.md` |

## Минимальный workflow для агента в новой сессии

1. Прочитать этот файл.
2. Прочитать `docs/roadmap.md` чтобы понять, на каком этапе проект сейчас.
3. Если задача связана с конкретным доменом — прочитать соответствующий `*/CLAUDE.md` или `*/README.md`.
4. Перед действием с побочными эффектами (запись в БД, деплой Worker, правка xlsx) — backup или подтверждение.
