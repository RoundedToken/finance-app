# Финансовый Excel

Один файл: `Finances.xlsx`. Любые программные изменения — через скрипты в
`scripts/`, потому что в файле есть chart, формулы и form controls, которые
при наивной перезаписи могут пропасть.

Полная инструкция (для Claude и для тех, кто хочет понять, как тут всё устроено)
— в `CLAUDE.md`.

## Один раз — установка окружения

```bash
brew install python@3.13
brew install --cask libreoffice
python3.13 -m venv ~/.venvs/excel
source ~/.venvs/excel/bin/activate
pip install -r requirements.txt
```

## В каждой сессии

```bash
source ~/.venvs/excel/bin/activate
make inspect           # посмотреть, что в файле
```

## Быстрые операции

| Что нужно                            | Команда                                              |
|---|---|
| Увидеть структуру файла              | `make inspect`                                       |
| Сделать резервную копию              | `make backup`                                        |
| Прочитать данные первого листа       | `make read`                                          |
| Пересчитать формулы                  | `make calc`                                          |
| Откатиться к последнему бэкапу       | `python scripts/restore.py --latest`                 |
| Поменять одну ячейку                 | `python scripts/set_cell.py Sheet1 B5 "1234.56"`     |
| Записать формулу                     | `python scripts/add_formula.py Sheet1 C10 "=SUM(C2:C9)"` |
| Сравнить две версии файла            | `make diff A=Finances.xlsx B=backups/Finances.X.xlsx` |

## Куда падают бэкапы

`backups/` — `Finances.<YYYY-MM-DD_HHMMSS>.xlsx`. Создаются автоматически перед
любой записью через скрипты.
