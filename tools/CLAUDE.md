# tools/ — Excel-инструменты (для Legacy и для отладки регенерированного дашборда)

**Не источник правды.** Legacy-lens поверх `.xlsx` файлов (Legacy в `data/legacy/`; папка `reports/` после ADR-011 активно не используется). **Источник правды — Cloudflare D1** (ADR-011), не `local/finances.db` (тот — мёртвое наследие до-D1-эпохи). См. корневой `CLAUDE.md`.

## Структура

```
tools/
├── README.md          ← короткая шпаргалка
├── CLAUDE.md          ← этот файл
├── Makefile           ← быстрые команды
└── excel/             ← Python-скрипты для .xlsx
    ├── _common.py             — общие хелперы (WORKBOOK_PATH, atomic_save, inventory)
    ├── inspect_xlsx.py        — структурный паспорт .xlsx
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
- **Скрипты можно запускать** из корня репо: `python tools/excel/inspect_xlsx.py`. `_common.py` сам резолвит правильный путь.

## Когда использовать

1. **Работа с Legacy** `data/legacy/Finances.xlsx` — историческое содержимое, ручной журнал снимков до миграции (Этап 6).
2. ~~Отладка регенерированного `reports/Finances.generated.xlsx`~~ — регенерация снята ADR-011, папка `reports/` пуста/неактивна.
3. **Анализ любых сторонних .xlsx** (например, экспортов из банков).

## Главные правила

1. **Файл Legacy нетривиальный.** Содержит chart, calcChain, 6 form controls. `unzip -l data/legacy/Finances.xlsx`.
2. **Перед записью — backup.** `python tools/excel/backup.py` (или `make backup` из tools/).
3. **Atomic save.** `_common.atomic_save()` через `os.replace`.
4. **После save — roundtrip-check.** Сверяем что charts/tables/named_ranges не пропали.
5. **Файл не должен быть открыт в Excel/Numbers/LibreOffice** во время правки. Скрипты проверяют через `lsof`.

## Команды

Из корня репо (`/Users/stepan/Projects/finance-app/`), в активированном venv:

```bash
python tools/excel/inspect_xlsx.py
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
- `docs/architecture.md` — общая архитектура (D1 = ground truth; Excel — только legacy-архив).
- `docs/data-model.md` — куда мигрируем сущности.
- `data/legacy/` — где лежит Legacy `.xlsx`.
- `reports/` — legacy-папка регенерации (после ADR-011 не используется).
