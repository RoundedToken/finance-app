# tools/ — Excel-инструменты (для Legacy и для отладки регенерированного дашборда)

**Не источник правды.** Все эти инструменты работают с `.xlsx` файлами (Legacy в `data/legacy/` или regenerated в `reports/`). Источник правды — `local/finances.db`. См. корневой `CLAUDE.md`.

## Структура

```
tools/
├── README.md          ← короткая шпаргалка
├── CLAUDE.md          ← этот файл
├── Makefile           ← быстрые команды
└── excel/             ← Python-скрипты для .xlsx
    ├── _common.py             — общие хелперы (WORKBOOK_PATH, atomic_save, inventory)
    ├── inspect.py             — структурный паспорт .xlsx
    ├── backup.py / restore.py — резервные копии
    ├── read_sheet.py          — CSV/JSON-дамп листа
    ├── set_cell.py            — точечная правка ячейки
    ├── add_formula.py         — запись формулы
    ├── roundtrip_check.py     — сверка инвентаря после save
    ├── calc.py                — пересчёт формул через soffice
    ├── diff.py                — структурный diff
    ├── xml_dump.py            — распаковка XML-внутренностей
    └── to_csv.py              — экспорт листов
```

## Пути

- **WORKBOOK по умолчанию** — `data/legacy/Finances.xlsx`. Это переопределено в `_common.py:PROJECT_ROOT`. Если хочется поработать с другим файлом — передавай путь явно.
- **Бэкапы** — `data/legacy/backups/`. Скрипт `backup.py` пишет туда.
- **Скрипты можно запускать** из корня репо: `python tools/excel/inspect.py`. `_common.py` сам резолвит правильный путь.

## Когда использовать

1. **Работа с Legacy** `data/legacy/Finances.xlsx` — историческое содержимое, ручной журнал снимков до миграции (Этап 6).
2. **Отладка регенерированного** `reports/Finances.generated.xlsx` — `diff` с предыдущей версией, `inspect` инвентаря.
3. **Анализ любых сторонних .xlsx** (например, экспортов из банков).

## Главные правила

1. **Файл Legacy нетривиальный.** Содержит chart, calcChain, 6 form controls. `unzip -l data/legacy/Finances.xlsx`.
2. **Перед записью — backup.** `python tools/excel/backup.py` (или `make backup` из tools/).
3. **Atomic save.** `_common.atomic_save()` через `os.replace`.
4. **После save — roundtrip-check.** Сверяем что charts/tables/named_ranges не пропали.
5. **Файл не должен быть открыт в Excel/Numbers/LibreOffice** во время правки. Скрипты проверяют через `lsof`.

## Команды

Из корня (`/Users/stepan/Desktop/excel/`), в активированном venv:

```bash
python tools/excel/inspect.py
python tools/excel/backup.py
python tools/excel/read_sheet.py --values-only
python tools/excel/calc.py
python tools/excel/xml_dump.py
python tools/excel/to_csv.py
python tools/excel/diff.py data/legacy/Finances.xlsx data/legacy/backups/Finances.<ts>.xlsx
python tools/excel/restore.py --latest
```

Из `tools/`:
```bash
make inspect backup read calc xml to-csv restore
make diff A=… B=…
```

## Окружение

`source ../.venv/bin/activate` из tools/, или `source .venv/bin/activate` из корня.

## Связь с верхним уровнем

- Корневой `CLAUDE.md` — общие правила.
- `docs/architecture.md` — общая архитектура (Excel = dashboard, SQLite = ground truth).
- `docs/data-model.md` — куда мигрируем сущности.
- `data/legacy/` — где лежит Legacy `.xlsx`.
- `reports/` — где появляется регенерированный дашборд.
