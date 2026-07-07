# Финансовый Excel (legacy-lens)

Один файл: `data/legacy/Finances.xlsx` (не источник правды — тот в D1, ADR-011).
Любые программные изменения — через скрипты в `tools/excel/`, потому что в файле
есть chart, формулы и form controls, которые при наивной перезаписи могут пропасть.

Полная инструкция (для Claude и для тех, кто хочет понять, как тут всё устроено)
— в `tools/CLAUDE.md`.

## Один раз — установка окружения

Используется общий `.venv/` в корне репо (правило 8 корневого `CLAUDE.md`),
отдельный venv не создавать:

```bash
brew install python@3.13
brew install --cask libreoffice          # для make calc (пересчёт формул)
/opt/homebrew/bin/python3.13 -m venv .venv   # из корня репо, если ещё нет
source .venv/bin/activate
pip install -r requirements.txt
```

## В каждой сессии

```bash
source .venv/bin/activate    # из корня репо
cd tools && make inspect     # посмотреть, что в файле
```

## Быстрые операции

Команды `make` — из `tools/`; команды `python` — из корня репо:

| Что нужно                            | Команда                                              |
|---|---|
| Увидеть структуру файла              | `make inspect`                                       |
| Сделать резервную копию              | `make backup`                                        |
| Прочитать данные первого листа       | `make read`                                          |
| Пересчитать формулы                  | `make calc`                                          |
| Откатиться к последнему бэкапу       | `python tools/excel/restore.py --latest`             |
| Поменять одну ячейку                 | `python tools/excel/set_cell.py Sheet1 B5 "1234.56"` |
| Записать формулу                     | `python tools/excel/add_formula.py Sheet1 C10 "=SUM(C2:C9)"` |
| Сравнить две версии файла            | `make diff A=… B=…`                                  |

## Куда падают бэкапы

`data/legacy/backups/` — `Finances.<YYYY-MM-DD_HHMMSS>.xlsx`. Создаются
автоматически перед любой записью через скрипты.
