# Personal Finance System

Полная личная финансовая система с двумя клиентскими каналами и единым облачным backend'ом.

## TL;DR для агента (актуальная архитектура — см. ADR-011, ADR-012)
- **D1 (Cloudflare SQLite)** — **единственный источник правды**. Не локальный SQLite.
- **Cloudflare Worker** (`cloud/worker/`) — единственный API. Endpoints: `/v1/expenses/*` (Mini App), `/v1/admin/*` (Web Admin), `/v1/auth/google/*`, `/tg` (bot webhook), `/v1/rates/*`.
- **Mini App в Telegram** (`cloud/miniapp/`) — ввод расходов с iPhone. **Закрытый scope: только ввод, дальше не растёт** (аналитика расходов — в Web Admin). Auth: Telegram `initData` HMAC.
- **Web Admin** (`cloud/admin/`) — React SPA для снапшотов, доходов, обменов, дашбордов, портфеля, инвестиций (крипто-портфель ETH/стейкинг, SPEC-026) **и аналитики расходов**. Auth: Google OAuth → JWT HS256 → `Authorization: Bearer`. Свободные деньги: `free = net − targeted − invested` (инвест-ведро `accounts.is_investment=1` входит в net, исключается из free).
- **MacBook** — только daily backup D1 через `wrangler d1 export`. Может быть выключен неделями.
- Всё на Cloudflare Pages + Workers + D1 — **бесплатно**, без VPS.

## Текущий этап
Единственный источник истины о стадии — `docs/roadmap.md` (не дублируем номер здесь, чтобы не дрейфил). Кратко: базовые потоки закрыты, идёт **Стадия 2 — глубокий рефакторинг перед закрытием MVP** (план: `docs/review-mvp-stage1.md`). Mini App — «полировка по запросу».

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
├── local/                        ← backup D1 + UI тест-харнесы + разовые импорты (НЕ источник правды)
│   ├── scripts/                  — детали и как запускать: local/README.md § Тестовые харнесы
│   │   ├── backup_d1.py          — wrangler d1 export → iCloud Drive (daily)
│   │   ├── test_admin_ui.py      — Playwright Web Admin (mock JWT + mock /v1/**, скриншоты)
│   │   ├── test_miniapp_ios.py   — Appium + iOS Simulator (РЕАЛЬНАЯ клавиатура iOS)
│   │   ├── test_miniapp_react.py — Playwright Mini App React (light/dark)
│   │   ├── test_ui.py            — legacy тестер старого vanilla Mini App
│   │   ├── _common.py            — общие константы (пути GCP key и т.п.)
│   │   ├── setup_rates_sheet.py  — настройка Google Sheet с GOOGLEFINANCE
│   │   ├── backfill_rates.py     — заливка исторических курсов
│   │   └── import_legacy_snapshots.py / import_ok_csv.py — разовые импорты
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

11. **Mini App scope: ввод расходов + read-only аналитика расходов + read-only подсказки.** Не расширять Mini App новыми разделами с CRUD (снапшоты/доходы/обмены). **Read-only аналитика расходов в Mini App разрешена** (экран «📊 Статистика», SPEC-036 / ADR-021, owner-решение 2026-06-27 — частичная отмена прежнего freeze): KPI/donut/тренд/drill-down поверх трат, чистое чтение, без нового CRUD (единственная мутация — переход в существующий edit-экран траты). **Глубокая** аналитика (доходы, снапшоты, цели, портфель, net worth) живёт **только в Web Admin** — Mini App считает только расходы и не дублирует Admin. Допустимы **read-only подсказки в момент ввода** (без CRUD): остаток бюджета по категории «осталось X €» (SPEC-020) и накопленное в годовом конверте lumpy-категории «🐷 X €» (SPEC-023), owner-решения 2026-05-31. Любое подобное расширение — только read-only; управление (CRUD лимитов, адаптивные настройки/override, не-расходная аналитика) остаётся в Admin.

12. **Не редактировать `data/legacy/Finances.xlsx` напрямую.** Соблюдать правила из `tools/CLAUDE.md` (atomic save, backup, roundtrip-check).

13. **Когда непонятно direction — спросить пользователя.** Не угадывать архитектурные решения.

14. **Push и deploy — автономно, без отдельного разрешения.** После реализации фичи довожу её до прода сам: push ветки → дождаться зелёного CI → merge в `main` → задеплоить (`cloud/worker` `npm run deploy`, `cloud/admin`/`cloud/miniapp` build+`wrangler pages deploy`, применить новые миграции D1) → проверить на проде. Stepan смотрит результат **на продакшене** (review post-factum), а не PR — поэтому не останавливаюсь на «PR создан / готово к деплою» и не спрашиваю «пушить?/деплоить?». **Деплой только из merged `main`** (feature-ветки делят один прод — затрёшь чужое; см. memory `deploy-only-from-merged-main`): сначала merge → build → локальный визуал-тест (memory `frontend-test-locally-before-deploy`) → deploy. Перед миграцией D1 — backup (правило 7). Cloudflare Pages отклоняет не-ASCII commit-message → `--commit-message="ASCII"`. Подтверждение приберечь **только** для реально необратимого/опасного (drop/перезапись данных, mass-migration). См. memory `autonomous-push-deploy`, `be-proactive-fewer-checkpoints`.

15. **Спеки/ADR — это задачи со статусами; `status` во фронтматтере = источник истины «что сделано».** Порядок фич НЕ предопределён (сделали SPEC-023 → можем взять SPEC-030, не по номерам). Поэтому статусы обязательны и ведутся по ходу: взяли фичу в работу → сразу `status: in_progress` (+ строка в changelog спеки); **выкатили на прод** → `status: done` (+ changelog + отметка ✅ в `roadmap`/`post-mvp-roadmap`). Никогда: задеплоенная фича в `draft`/`in_progress`, или недоделанная/не-в-проде в `done`. Что готово, а что нет — смотреть статусы спек, не память/догадки. ADR — так же: новое решение фиксируется ADR'ом сразу. См. memory `spec-status-discipline`.

## Где что искать

| Вопрос | Файл |
|---|---|
| Как мы разрабатываем фичи (pipeline) | `docs/process.md` |
| Security protocols (что прячем, как, hooks) | `docs/security.md` |
| Спецификации фич | `specs/SPEC-NNN-*.md` |
| Общая архитектура, диаграмма потоков | `docs/architecture.md` |
| Какие таблицы и поля в D1 | `docs/data-model.md` |
| Почему такие решения | `docs/decisions.md` (ADR-001…021) |
| Как поднять проект с нуля | `docs/setup.md` |
| Полный список зависимостей и версий | `docs/stack.md` |
| Что сейчас делаем, что дальше | `docs/roadmap.md` |
| Mini App код (React, SPEC-014) | `cloud/miniapp/src/` |
| Worker код (API + bot + auth + dashboard) | `cloud/worker/src/` |
| Web Admin код | `cloud/admin/src/` |
| Excel-инспекция (legacy lens) | `tools/CLAUDE.md` |
| Source data (CSV/скрины/Legacy xlsx) | `data/README.md` |
| **Как тестировать UI** (Admin — Playwright+mock JWT; Mini App — iOS Simulator/Playwright) | `local/README.md` § Тестовые харнесы |
| Локальные скрипты (backup D1, разовые импорты) | `local/README.md` |

## Минимальный workflow для агента в новой сессии

1. Прочитать этот файл.
2. Прочитать `docs/process.md` — как работает spec-driven pipeline.
3. Прочитать `docs/roadmap.md` — на каком stage проект сейчас.
4. Прочитать `docs/security.md` — обязательный чеклист перед push (репо публичный).
5. Если задача связана с конкретным доменом — прочитать соответствующий `*/CLAUDE.md` или `*/README.md`.
6. Перед действием с побочными эффектами (запись в D1, деплой Worker/Pages, правка xlsx) — backup или подтверждение.
7. Любая новая фича начинается с `specs/SPEC-NNN-<slug>.md`, не с кода.
