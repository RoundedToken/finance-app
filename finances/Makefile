.PHONY: help install inspect backup read calc xml to-csv diff restore

WORKBOOK := Finances.xlsx
PYTHON ?= python3

help:
	@echo "Make targets (run from finances/ dir):"
	@echo "  install      install python deps (run inside activated venv)"
	@echo "  inspect      structural report of $(WORKBOOK)"
	@echo "  backup       timestamp copy into backups/"
	@echo "  read         dump first sheet as CSV (cached values)"
	@echo "  calc         recalc formulas via headless LibreOffice"
	@echo "  xml          extract internal XML into /tmp/finances-xml-<ts>/"
	@echo "  to-csv       export every sheet into csv/"
	@echo "  diff A=… B=… structural diff between two .xlsx"
	@echo "  restore      restore most recent backup"

install:
	pip install -r requirements.txt

inspect:
	$(PYTHON) scripts/inspect.py

backup:
	$(PYTHON) scripts/backup.py

read:
	$(PYTHON) scripts/read_sheet.py --values-only

calc:
	$(PYTHON) scripts/calc.py

xml:
	$(PYTHON) scripts/xml_dump.py

to-csv:
	$(PYTHON) scripts/to_csv.py

diff:
	$(PYTHON) scripts/diff.py "$(A)" "$(B)"

restore:
	$(PYTHON) scripts/restore.py --latest
