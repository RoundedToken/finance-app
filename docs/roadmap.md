# Roadmap

Что сделано, что в работе, что впереди.

## Этап 0 — Инфраструктура и документация ✅ В работе

- [x] Структура директорий (`finances/`, `local/`, `cloud/`, `docs/`)
- [x] Архитектурная документация (`docs/*.md`, корневой `CLAUDE.md`)
- [x] Excel-инспекционные tools в `finances/scripts/` (inspect, backup, diff, ...)
- [x] Установлены brew пакеты: python@3.13, node
- [ ] Создан venv в `.venv/` + pip install
- [ ] Установлен wrangler
- [ ] Создан Cloudflare-аккаунт (требует действий пользователя)
- [ ] Создан Telegram bot через @BotFather (требует действий пользователя)
- [ ] git init + первый коммит
- [ ] SQLite-схема для локальной БД (`local/schema.sql`)
- [ ] SQLite-схема для D1 (`cloud/worker/schema.sql`)
- [ ] Заглушка Cloudflare Worker (TypeScript-скелет)
- [ ] Заглушка Mini App (HTML)

## Этап 1 — End-to-end "минимальная цепочка"

Цель: запись с iPhone → попадание в локальный SQLite. UI ещё нет, бот текстовый.

- [ ] Worker: webhook `/tg` принимает сообщение от bot
- [ ] Worker: парсит строку `<amount> <currency> <category>` (например, `25 EUR food`)
- [ ] Worker: пишет в `expenses_outbox` D1
- [ ] Worker: отправляет confirmation в чат
- [ ] D1 schema deployed
- [ ] `local/scripts/sync.py` — pull + insert + confirm
- [ ] `local/scripts/init_db.py` — создание БД
- [ ] launchd-агент для автоматического sync
- [ ] Smoke-test: одна тестовая трата заехала с телефона в local SQLite

## Этап 2 — Mini App с UI «Расходы ОК»

Цель: красивый UI ввода, копия UX «Расходы ОК».

- [ ] HTML/CSS Mini App: сетка категорий, числовая клавиатура, выбор счёта
- [ ] Telegram WebApp API: получение `initData`, отправка на Worker
- [ ] Worker: валидация `initData`, авторизация по telegram_id
- [ ] Pages deploy для Mini App
- [ ] Bootstrap-endpoint `/v1/bootstrap` — Mini App подтягивает справочники
- [ ] LocalStorage outbox в Mini App для офлайн-ввода
- [ ] @BotFather: установлен `setmenubutton` → Mini App URL

## Этап 3 — Курсы и дашборд

- [ ] `local/scripts/fetch_rates.py` — Google Sheets CSV → таблица `rates`
- [ ] `local/scripts/regenerate_xlsx.py` — генерация `Finances.xlsx` с дашбордом:
  - Сводка балансов по счетам
  - Аллокация по валютам / группам
  - Динамика капитала (график)
  - Implicit cashflow между снапшотами
- [ ] launchd: ежедневный fetch_rates

## Этап 4 — Импорт CSV из «Расходы ОК»

- [ ] Получить тестовый CSV-экспорт от пользователя
- [ ] `local/scripts/import_ok_csv.py` — парсер с маппингом категорий
- [ ] Прогнать импорт, проверить итоги

## Этап 5 — Снапшоты и обмены через Mini App

- [ ] Mini App: вкладка «Снапшоты» — ввод баланса по счёту
- [ ] Mini App: вкладка «Обмен» — мульти-валютная форма с фиксацией курса
- [ ] Mini App: цепочки (chain_id) — связать несколько обменов в одну операцию
- [ ] Worker: новые endpoints `/v1/snapshots`, `/v1/transactions`

## Этап 6 — Миграция Legacy

- [ ] Из текущего `Finances.xlsx` (Legacy) восстановить Snapshots в нативных валютах:
  - По историческим курсам ЕЦБ/ЦБ РФ обратная конверсия EUR-eq → RUB/RSD/USDT
  - Записать как `source = 'estimated_from_legacy'`
- [ ] Сохранить `finances/Finances.xlsx` как `finances/Legacy.xlsx`
- [ ] Регенерируемый Finances.xlsx становится основным

## Этап 7 — Инвестиции (опционально, на будущее)

- [ ] Поле `yield_pct` на Account (уже в схеме)
- [ ] Автоматическая транзакция типа `interest` при ежемесячном начислении
- [ ] Дашборд: ожидаемый доход за период
- [ ] (когда появятся) Holdings: акции/ETF с тикерами

## Текущий этап
**Этап 0**. После завершения переходим к Этапу 1 (требует Cloudflare-аккаунт + bot token от пользователя).

## Метрики готовности

| Этап | Готов когда |
|---|---|
| 0 | Все папки на месте, документация написана, venv активирован, git инициализирован, brew пакеты стоят |
| 1 | Smoke-test (трата с телефона → local SQLite) проходит |
| 2 | Mini App открывается в Telegram, ввод работает, UI выглядит как «Расходы ОК» |
| 3 | `Finances.xlsx` регенерируется и показывает дашборд с актуальными курсами |
| 4 | Полная история из «Расходы ОК» — в локальной БД |
| 5 | Снапшоты и обмены вводятся с телефона |
| 6 | Legacy-данные восстановлены, новый Finances.xlsx — единственный |
| 7 | Прогноз доходов от инвестиций есть на дашборде |
