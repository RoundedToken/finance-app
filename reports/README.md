# reports/ — legacy-папка (gitignored)

> ⚠️ **HISTORICAL (до-D1 эпоха, ADR-011): описанный ранее pipeline не существует.**
> Папка предназначалась для артефактов, регенерируемых из локального SQLite
> (`regenerate_xlsx.py` → `Finances.generated.xlsx`). После pivot к D1 (ADR-011)
> локальной БД и regen-скриптов нет; все дашборды живут в Web Admin.

Активной генерации нет. В git только этот README. Содержимое (если осталось) —
безопасно удалять. Для Excel-lens поверх legacy-файла — см. `tools/CLAUDE.md`.
