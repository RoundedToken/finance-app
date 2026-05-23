# local — локальный SQLite + sync + регенерация Excel

Здесь живёт **источник правды** всей системы: `finances.db` (SQLite). Сюда же — все скрипты, которые с ней работают: создание БД, миграции, sync из облака, регенерация Excel.

## Содержимое

```
local/
├── README.md              ← этот файл
├── schema.sql             ← current snapshot схемы (для людей)
├── migrations/            ← нумерованные миграции (для init_db.py)
│   └── 001_init.sql
├── scripts/
│   ├── init_db.py         ← применяет миграции, создаёт finances.db
│   ├── sync.py            ← pull из D1, insert local, confirm
│   ├── regenerate_xlsx.py ← собрать Finances.xlsx из БД
│   ├── fetch_rates.py     ← Google Sheets CSV → таблица rates
│   ├── add_account.py     ← TUI-добавление счёта
│   ├── add_transaction.py ← TUI-добавление обмена/перевода
│   ├── add_snapshot.py    ← TUI-ввод снапшота баланса
│   ├── import_ok_csv.py   ← миграция CSV из «Расходы ОК»
│   └── _common.py         ← общие утилиты (paths, db connection, env)
├── backups/               ← копии finances.db с timestamp
├── logs/                  ← sync.log и другие
└── finances.db            ← (создаётся init_db.py, в .gitignore)
```

## Quick reference команд

```bash
# Активировать venv (в корне репо)
source ../.venv/bin/activate

# Создать БД (или применить новые миграции)
python scripts/init_db.py

# Запустить sync
python scripts/sync.py --once
python scripts/sync.py --watch        # бесконечный цикл (для launchd)

# Регенерировать Excel
python scripts/regenerate_xlsx.py

# Подтянуть курсы
python scripts/fetch_rates.py
```

## Принципы работы с БД

1. **Не редактировать `schema.sql` напрямую** для изменений.
   Сделать новую миграцию `migrations/00X_<имя>.sql`, потом обновить `schema.sql` как зеркало.

2. **Перед миграцией / правкой данных — backup.**
   ```bash
   cp finances.db backups/finances.$(date +%Y%m%d_%H%M%S).db
   ```

3. **Не открывать БД параллельно из нескольких процессов на запись.**
   WAL-режим помогает (`PRAGMA journal_mode = WAL`), но всё равно — sync + ручная правка одновременно = риск.

4. **Все timestamps — ISO 8601 в UTC.**

5. **При расхождении локальной БД и D1 — права у локальной.**
   D1 — транзитный буфер, локальная БД — ground truth.

## Sync state

В таблице `sync_state` хранятся служебные ключи:

| key | value | смысл |
|---|---|---|
| `last_synced_at` | ISO timestamp | до какого момента уже забрали из D1 |
| `last_xlsx_regenerated_at` | ISO timestamp | когда последний раз пересобирали Excel |
| `last_rates_fetched_at` | ISO timestamp | когда тянули курсы |
| `last_references_pushed_at` | ISO timestamp | когда пушили справочники в D1 |
| `schema_version` | integer | последняя применённая миграция |

## Бэкап и восстановление

**Авто-бэкап** через launchd-агент `com.user.excel-backup.plist` копирует `finances.db` в:
- `local/backups/finances.<ts>.db` (локальная история, последние 30)
- `~/Library/Mobile Documents/com~apple~CloudDocs/finances-backups/finances.<ts>.db` (iCloud Drive, удалённая копия)

**Восстановление:**
```bash
cp local/backups/finances.2026-05-23_120000.db local/finances.db
python scripts/regenerate_xlsx.py
```

## Расположение в общей системе

```
Cloudflare D1 (cloud, transient)
        │
        │ sync.py pulls
        ▼
local/finances.db (this — ground truth)
        │
        │ regenerate_xlsx.py reads
        ▼
finances/Finances.xlsx (read-only dashboard)
```
