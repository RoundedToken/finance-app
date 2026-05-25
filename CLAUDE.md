# Personal Finance System

Полная личная финансовая система с двумя клиентскими каналами и единым облачным backend'ом.

## TL;DR для агента (актуальная архитектура — см. ADR-011, ADR-012)
- **D1 (Cloudflare SQLite)** — **единственный источник правды**. Не локальный SQLite.
- **Cloudflare Worker** (`cloud/worker/`) — единственный API. Endpoints: `/v1/expenses/*` (Mini App), `/v1/admin/*` (Web Admin), `/v1/auth/google/*`, `/tg` (bot webhook), `/v1/rates/*`.
- **Mini App в Telegram** (`cloud/miniapp/`) — ввод расходов с iPhone + аналитика расходов. **Закрытый scope, дальше не растёт.** Auth: Telegram `initData` HMAC.
- **Web Admin** (`cloud/admin/`, в работе с stage 4) — React SPA для снапшотов, доходов, обменов, дашбордов, портфеля. Auth: Google OAuth → JWT HS256 → `Authorization: Bearer`.
- **MacBook** — только daily backup D1 через `wrangler d1 export`. Может быть выключен неделями.
- Всё на Cloudflare Pages + Workers + D1 — **бесплатно**, без VPS.

## Текущий этап
**Stage 4 — Web Admin Bootstrap.** Mini App в режиме «полировка по запросу». См. `docs/roadmap.md`.

## Структура репозитория

```
excel/                            # имя корня — historical; см. ADR-011 о возможном переименовании
├── CLAUDE.md, README.md          ← entry points
├── docs/                         ← вся архитектурная документация
│   ├── architecture.md           — общая архитектура и диаграммы
│   ├── data-model.md             — SQLite-схемы (D1)
│   ├── decisions.md              — ADR-001…012
│   ├── setup.md                  — как поднять проект с нуля
│   ├── stack.md                  — технологический стек
│   └── roadmap.md                — план этапов и текущий статус
├── data/                         ← source data (личные, gitignored — только README в git)
│   ├── README.md
│   ├── legacy/                   — Finances.xlsx (старый ground truth) + бэкапы
│   └── money-ok/                 — CSV-экспорт из «Расходы ОК» + скриншоты UI
├── local/                        ← только backup-скрипты + Playwright UI-тестер
│   ├── scripts/
│   │   ├── backup_d1.py          — wrangler d1 export → iCloud Drive (daily)
│   │   ├── test_ui.py            — Playwright UI-тестер для Mini App (iPhone 15 Pro Max)
│   │   ├── _common.py            — общие константы (пути GCP key и т.п.)
│   │   ├── setup_rates_sheet.py  — настройка Google Sheet с GOOGLEFINANCE
│   │   └── backfill_rates.py     — заливка исторических курсов
│   ├── launchd/                  — plist для автозапуска backup_d1.py
│   ├── backups/                  — копии D1 (sql dump)
│   └── logs/                     — backup.out.log, backup.err.log
├── cloud/                        ← вся облачная часть
│   ├── worker/                   — Worker TypeScript: REST API + bot + auth + cron
│   │   ├── src/                  — index.ts, bot.ts, auth.ts, auth-google.ts, jwt.ts, db.ts, rates.ts, types.ts
│   │   ├── schema.sql, migrations/
│   │   └── wrangler.toml, package.json
│   ├── miniapp/                  — Telegram Mini App (HTML/CSS/JS, vanilla)
│   │   └── public/
│   └── admin/                    — Web Admin (React + Vite + TanStack + shadcn/ui)
│       ├── src/                  — main.tsx, App.tsx, routes/, components/, api/
│       ├── index.html, vite.config.ts, tsconfig.json
│       ├── tailwind.config.ts, postcss.config.js, components.json
│       └── package.json
├── tools/                        ← Excel-инструменты (Legacy: data/legacy/Finances.xlsx)
│   ├── README.md, CLAUDE.md
│   └── excel/                    — 12 утилит для .xlsx
└── reports/                      ← устаревшая папка для regen xlsx (gitignored, after ADR-011 не используется активно)
```

**Историческая заметка**: корень папки называется `excel/`, что не отражает текущий scope. Переименовать — отдельная задача (см. roadmap, tech debt #20).

## Главные правила для агента

0. **Spec-driven workflow** (ADR-013). Каждая фича = `specs/SPEC-NNN-<slug>.md` ДО кода. См. `docs/process.md`. Пайплайн: Discovery+Spec → Implementation → Test+Review (параллельно через `senior-qa` + `solution-architect` subagents) → Push (безусловно, даже с must-fix). Никакого silent додумывания scope.

1. **D1 — источник правды.** Никакой локальной БД. Все CRUD идут через Worker → D1. Локальные скрипты только backup и UI-тестер.

2. **Схема D1 меняется только через миграции.** `cloud/worker/migrations/` — нумерованные SQL-файлы. Никогда не редактировать применённую миграцию — только добавлять новую. `cloud/worker/schema.sql` обновляется параллельно как «текущий снапшот».

3. **Cloudflare деплой — только через wrangler.** Не править Worker/D1 через веб-дашборд CF. Все изменения — через `cloud/worker/wrangler.toml` + git.

4. **Два независимых auth-канала на одном Worker:**
   - Mini App: Telegram `initData` HMAC (через bot token).
   - Web Admin: Google OAuth → JWT HS256 (allowlist email из `ADMIN_ALLOWED_EMAILS` wrangler var).
   Каждое мутирующее endpoint должно требовать один из них. Не смешивать.

5. **Секреты — в `wrangler secret` (для облака) и `.env` (локально).**
   `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_SECRET`, `ADMIN_JWT_SECRET` — никогда в коде и не в git.
   GCP Service Account JSON для Sheets — `~/.config/finances-gsheets/key.json`, в .gitignore (см. memory `gcp_service_account_key.md`).

6. **Идемпотентность писем — обязательна.** Каждая запись имеет UUID (генерится на клиенте). `INSERT OR IGNORE` по UUID. Повторная отправка безопасна.

7. **Перед массовой миграцией данных — backup D1.**
   `wrangler d1 export finances-outbox --output=local/backups/d1-<ts>.sql` (или `python local/scripts/backup_d1.py`).

8. **macOS-specific:**
   - Python 3.13 в `.venv/` корня проекта. **Не использовать системный Python 3.9.6.**
   - Node + npm для wrangler. Wrangler ставится глобально (`npm install -g wrangler`).
   - launchd-агент для backup прописывается в `~/Library/LaunchAgents/com.user.excel-backup.plist`.

9. **Bot не отвечает никому, кроме `authorized_users`.** Правило безопасности (ADR-009). Не добавлять «фолбэк-приветствия» для unauthorized — только логирование. Для добавления нового пользователя — `wrangler d1 execute INSERT INTO authorized_users`.

10. **Web Admin allowlist — хардкод-проверка email через `ADMIN_ALLOWED_EMAILS`.** Не добавлять «открытую» регистрацию. CSV-список разрешённых email задаётся в wrangler vars (см. `wrangler.example.toml`). См. ADR-012.

11. **Mini App scope зафиксирован.** Не расширять Mini App новыми разделами (снапшоты/доходы/обмены). Эти фичи живут только в Web Admin. В Mini App — только ввод расходов + аналитика расходов.

12. **Не редактировать `data/legacy/Finances.xlsx` напрямую.** Соблюдать правила из `tools/CLAUDE.md` (atomic save, backup, roundtrip-check).

13. **Когда непонятно direction — спросить пользователя.** Не угадывать архитектурные решения.

## Где что искать

| Вопрос | Файл |
|---|---|
| Как мы разрабатываем фичи (pipeline) | `docs/process.md` |
| Security protocols (что прячем, как, hooks) | `docs/security.md` |
| Спецификации фич | `specs/SPEC-NNN-*.md` |
| Общая архитектура, диаграмма потоков | `docs/architecture.md` |
| Какие таблицы и поля в D1 | `docs/data-model.md` |
| Почему такие решения | `docs/decisions.md` (ADR-001…012) |
| Как поднять проект с нуля | `docs/setup.md` |
| Полный список зависимостей и версий | `docs/stack.md` |
| Что сейчас делаем, что дальше | `docs/roadmap.md` |
| Mini App код | `cloud/miniapp/public/` |
| Worker код (API + bot + auth) | `cloud/worker/src/` |
| Web Admin код | `cloud/admin/src/` |
| Excel-инспекция (legacy lens) | `tools/CLAUDE.md` |
| Source data (CSV/скрины/Legacy xlsx) | `data/README.md` |
| Локальные скрипты (backup, тестер) | `local/README.md` |

## Минимальный workflow для агента в новой сессии

1. Прочитать этот файл.
2. Прочитать `docs/process.md` — как работает spec-driven pipeline.
3. Прочитать `docs/roadmap.md` — на каком stage проект сейчас.
4. Прочитать `docs/security.md` — обязательный чеклист перед push (репо публичный).
5. Если задача связана с конкретным доменом — прочитать соответствующий `*/CLAUDE.md` или `*/README.md`.
6. Перед действием с побочными эффектами (запись в D1, деплой Worker/Pages, правка xlsx) — backup или подтверждение.
7. Любая новая фича начинается с `specs/SPEC-NNN-<slug>.md`, не с кода.
