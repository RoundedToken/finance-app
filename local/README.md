# local — backup D1 + тест-харнесы + разовые скрипты

> **Важно (ADR-011/012):** источник правды — **Cloudflare D1**, не локальная БД.
> Папка `local/` НЕ содержит «ground truth». Здесь только: бэкап D1, локальные
> UI-тест-харнесы и разовые import/setup-скрипты. MacBook может быть выключен
> неделями — на работу облака это не влияет.
>
> **Миграции:** единственные живые миграции схемы — `cloud/worker/migrations/`
> (D1). Локальные `local/migrations/` + `local/schema.sql` + `init_db.py` +
> `migrate_to_d1.py` — наследие до-D1-эпохи, описывают СТАРУЮ local-SQLite
> схему. Их не применять к боевой системе; оставлены как архив (`_common.py`
> их шарит, поэтому физически не вынесены).

## 🧪 Тестовые харнесы (читать перед любой frontend-задачей)

Frontend **нельзя** деплоить непроверенным (правило Степана, см. memory
`frontend-test-locally-before-deploy`). Запускать из корня репо через venv:
`.venv/bin/python local/scripts/<harness>.py`. Скриншоты → `local/screenshots/`,
их надо **открыть глазами** (Read PNG) в light и dark.

**Setup (один раз):** харнесам нужен `playwright` в `.venv`:
`.venv/bin/python -m pip install playwright && .venv/bin/python -m playwright install chromium`.
Если `pip`/`playwright` ругаются на `bad interpreter` — значит `.venv` создан по старому
пути (проект переехал): пересоздать `/opt/homebrew/bin/python3.13 -m venv .venv` +
`-r requirements.txt` + playwright. `.venv` в `.gitignore`.

| Харнес | Что тестирует | Как |
|---|---|---|
| **`test_admin_ui.py`** | **Web Admin** (React SPA). Поднимает `vite dev` для `cloud/admin`, кладёт mock-JWT в localStorage, перехватывает **все** `/v1/**` моками (mock-данные прямо в скрипте: ACCOUNTS, INCOMES, GOALS, DASHBOARD…). Скриншоты `admin-*.png`. Покрывает дашборд (обе линзы + ETA + адаптивная проекция), доходы, снапшоты, обмены, цели, расходы, sidebar. **Не нужен** реальный Google-auth / D1. | `.venv/bin/python local/scripts/test_admin_ui.py [--headed]` |
| **`test_miniapp_ios.py`** | **Mini App на РЕАЛЬНОМ iOS** через Appium + Xcode iOS Simulator. Единственный способ воспроизвести баги нативной клавиатуры iOS (скачки, scroll-lock, фокус). Мокает Telegram+fetch, гасит Safari-онбординг. Детали запуска — в memory `ios-appium-keyboard-test` (Appium server, capabilities, nativeWebTap). | см. docstring + memory |
| **`test_miniapp_react.py`** | **Mini App (React, SPEC-014)** через Playwright Chromium. Мокает Telegram+fetch (блокирует реальный `telegram-web-app.js`), скриншоты light/dark → `local/screenshots/react/`, ловит console errors. Быстрая проверка вёрстки/темы (НЕ ловит iOS-клавиатуру — для этого iOS-харнес). | `.venv/bin/python local/scripts/test_miniapp_react.py [--dark]` |
| `test_ui.py` | Legacy: старый vanilla Mini App (до React-переписывания). Оставлен для истории. | — |

**Цикл frontend-фичи:** код → `npm --prefix cloud/<app> run build` → харнес → Read
скриншоты (light+dark) → фикс → повтор → только потом deploy.

## 💾 Backup D1

- **`backup_d1.py`** — `wrangler d1 export finances-outbox` → `local/backups/d1-<ts>.sql`
  + verify-фаза (импорт в temp-sqlite) + копия в iCloud Drive. Запускается launchd-агентом
  ежедневно в 10:30 (`launchd/com.user.finance-backup.plist`, установка — `docs/setup.md`).
  Вторая линия защиты — D1 Time Travel (30 дней point-in-time, см. `docs/architecture.md`
  § Модель восстановления).
- **Перед массовой правкой данных в D1 — делать backup вручную:**
  ```bash
  cd cloud/worker && wrangler d1 export finances-outbox --remote \
    --output=../../local/backups/d1-pre-<что>-$(date +%Y%m%d-%H%M%S).sql
  ```

## 🚑 Restore-runbook (аудит 2026-07, DB-06)

Порядок восстановления по сценарию:

**A. Испортили данные / кривая миграция (аккаунт CF жив)** — сначала **D1 Time Travel**
(point-in-time, 30 дней, ничего не настраивается):
```bash
cd cloud/worker
wrangler d1 time-travel info finances-outbox                  # текущий bookmark (сохранить!)
wrangler d1 time-travel restore finances-outbox --timestamp=<unix|ISO-до-инцидента>
```

**B. Аккаунт CF потерян / горизонт >30 дней** — восстановление из `.sql`-дампа
(`local/backups/` или iCloud `finances-backups/`):

1. Создать **пустую** D1: `wrangler d1 create finances-restored`.
   ⚠ **НЕ применять schema.sql перед импортом**: дамп содержит собственный DDL
   (`CREATE TABLE` без `IF NOT EXISTS`) — на непустой базе импорт упадёт на первом
   же `already exists`. Дамп самодостаточен (DDL + данные + справочники).
2. Импорт: `wrangler d1 execute finances-restored --remote --file=../../local/backups/d1-<последний>.sql`
3. Smoke: `wrangler d1 execute finances-restored --remote --command="SELECT (SELECT COUNT(*) FROM expenses), (SELECT COUNT(*) FROM snapshots), (SELECT COUNT(*) FROM rates), (SELECT MAX(date) FROM expenses WHERE deleted_at IS NULL)"` — counts ненулевые, дата свежая.
4. Перебиндить `database_id` новой базы в `cloud/worker/wrangler.toml` (gitignored).
5. Передеплоить worker: `npm run deploy`. Проверить `/healthz` и вход в Mini App/Admin.

**Ритуал**: verify-фаза `backup_d1.py` гоняет мини-учение (импорт в temp-sqlite,
counts) при каждом бэкапе автоматически; раз в квартал — ручное учение по шагам B
в локальную sqlite (`python - <<'EOF' … executescript(дамп) …` + smoke-запросы п.3).
Последнее учение: **2026-07-07** — дамп 2026-07-07 восстановлен в чистую sqlite за
1.7 с: 1969 expenses / 218 snapshots / 5308 rates, 0 сирот, 0 FK-нарушений.

## 🛠 Разовые import / setup

| Скрипт | Назначение |
|---|---|
| `setup_rates_sheet.py` | Однократная настройка Google Sheet с `GOOGLEFINANCE` (источник курсов). |
| `backfill_rates.py` | Однократная заливка исторических курсов в таблицу `rates`. |
| `import_legacy_snapshots.py` | Импорт истории снапшотов из `data/legacy/Finances.xlsx` (EUR-eq → native по историческому курсу, UUID5-идемпотентность). |
| `import_ok_csv.py` | Миграция исторических трат из CSV «Расходы ОК». |
| `_common.py` | Общие константы (пути к GCP key и т.п.). |

> `init_db.py`, `migrate_to_d1.py` — наследие старой локально-SQLite эпохи
> (до pivot к D1). Не использовать в текущей архитектуре.

## Прямые операции с D1 (без скрипта)

CRUD идут через Worker, но для разовых правок/проверок — `wrangler d1 execute`:
```bash
cd cloud/worker
wrangler d1 execute finances-outbox --remote --command "SELECT ... "
# идемпотентная вставка истории: детерминированный id + INSERT OR IGNORE
```
Перед записью — backup (см. выше). Схема D1 меняется только миграциями
(`cloud/worker/migrations/`), `schema.sql` — зеркало-снапшот.
