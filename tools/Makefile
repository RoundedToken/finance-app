.PHONY: help inspect backup read calc xml to-csv diff restore

# Excel-инструменты для работы с data/legacy/Finances.xlsx (Legacy view).
# Запускать из корня проекта или из tools/ — пути относительны проекту.
# venv: source ../.venv/bin/activate (если из tools/)

PYTHON ?= python

help:
	@echo "Excel tools (operate on data/legacy/Finances.xlsx):"
	@echo "  inspect      structural report"
	@echo "  backup       timestamp copy into data/legacy/backups/"
	@echo "  read         dump first sheet as CSV (cached values)"
	@echo "  calc         recalc formulas via headless LibreOffice"
	@echo "  xml          extract internal XML into /tmp/finances-xml-<ts>/"
	@echo "  to-csv       export every sheet into ./csv/"
	@echo "  diff A=… B=… structural diff between two .xlsx"
	@echo "  restore      restore most recent backup"

inspect:
	$(PYTHON) excel/inspect_xlsx.py

backup:
	$(PYTHON) excel/backup.py

read:
	$(PYTHON) excel/read_sheet.py --values-only

calc:
	$(PYTHON) excel/calc.py

xml:
	$(PYTHON) excel/xml_dump.py

to-csv:
	$(PYTHON) excel/to_csv.py

diff:
	$(PYTHON) excel/diff.py "$(A)" "$(B)"

restore:
	$(PYTHON) excel/restore.py --latest
