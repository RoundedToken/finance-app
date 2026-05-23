# finances/ — Excel-папка (Legacy + dashboard view)

**Эта папка больше не источник правды.** Источник правды переехал в `local/finances.db` (SQLite). См. корневой `CLAUDE.md` и `docs/architecture.md`.

## Что здесь живёт

```
finances/
├── Finances.xlsx              ← LEGACY: текущий рабочий журнал снимков (старый формат)
├── Finances.generated.xlsx    ← (когда появится) dashboard, регенерируется из SQLite
├── CLAUDE.md                  ← этот файл
├── README.md                  ← короткая шпаргалка
├── Makefile                   ← команды Excel-инспекции
├── requirements.txt           ← python deps для local-tools (дубль корневого)
├── backups/                   ← бэкапы Finances.xlsx при ручных правках
└── scripts/                   ← 11 утилит для инспекции/правки .xlsx
    ├── _common.py             — общие хелперы (assert_not_open, atomic_save, inventory)
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

## Когда использовать эти инструменты

1. **Работа с Legacy** `Finances.xlsx`: инспекция, диагностика, аккуратные правки до миграции (Этап 6 roadmap'а).
2. **Отладка регенерированного `Finances.generated.xlsx`**: diff с предыдущей версией, проверка инвентаря.
3. **Анализ любых сторонних .xlsx**, которые понадобится распарсить.

## Главные правила (для Legacy)

1. **Файл нетривиальный.** Содержит chart, calcChain, 6 form controls. См. `unzip -l Finances.xlsx`.
2. **Перед записью — backup.** `python scripts/backup.py` (или Makefile-таргет `make backup`).
3. **Atomic save.** Все скрипты используют `_common.atomic_save()` (через `os.replace`).
4. **После save — roundtrip-check.** `python scripts/roundtrip_check.py Finances.xlsx backups/<latest>.xlsx`.
5. **Файл не должен быть открыт в Excel/Numbers/LibreOffice** во время правки. Скрипты проверяют через `lsof`.

## Команды (Makefile)

```bash
make inspect     # структурный паспорт Finances.xlsx
make backup
make read        # содержимое первого листа в CSV
make calc        # пересчитать формулы через LibreOffice headless
make xml         # распаковать XML внутренности
make to-csv      # экспорт всех листов в csv/
make diff A=… B=…
make restore     # восстановить последний backup
```

## Окружение

**Использовать venv из корня проекта**: `source ../.venv/bin/activate`.

В корневом `requirements.txt` уже есть всё, что нужно (openpyxl, xlsxwriter, calamine, xlcalculator, lxml, pandas).

Скрипты ссылаются на свои пути относительно `finances/`, поэтому работают независимо от других папок репо.

## Расположение в общей системе

```
local/finances.db (ground truth)
        │
        │ regenerate_xlsx.py
        ▼
finances/Finances.generated.xlsx   ← read-only dashboard (будет в Этапе 3)

finances/Finances.xlsx             ← LEGACY, ручной журнал (мигрируется в Этапе 6)
```

Скрипты в `scripts/` — переходный артефакт, ценный для Legacy-этапа. После полной миграции часть из них (`inspect`, `diff`, `xml_dump`) останутся полезными для отладки регенерированного дашборда.

## Связь с верхним уровнем

- Корневой `CLAUDE.md` — главные правила всей системы.
- `docs/architecture.md` — общая архитектура и почему Excel больше не ground truth.
- `docs/data-model.md` — куда перенесены сущности из Excel-листа.
- `docs/roadmap.md` — когда планируется миграция Legacy (Этап 6).
