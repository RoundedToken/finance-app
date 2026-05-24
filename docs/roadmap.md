# Roadmap

Что сделано, что в работе, что впереди. Обновляется по факту.

---

## ✅ Завершено

### Этап 0 — Инфраструктура и документация
- [x] Структура директорий (`data/`, `local/`, `cloud/`, `docs/`, `tools/`, `reports/`)
- [x] Архитектурная документация (`docs/*.md`, корневой `CLAUDE.md`, ADR-001…011)
- [x] Excel-инспекционные tools в `tools/excel/` (12 утилит)
- [x] brew пакеты: `python@3.13`, `node`. `.venv/` + `pip install -r requirements.txt`
- [x] `wrangler` глобально через npm
- [x] Cloudflare-аккаунт + Telegram bot через @BotFather
- [x] git init + первый коммит, репозиторий с историей
- [x] SQLite-схемы (local + D1), миграции
- [x] Cloudflare Worker (TypeScript) + Pages для Mini App

### Этап 1 — End-to-end "минимальная цепочка"
- [x] Worker `/tg` webhook + Telegram bot (silent для не-whitelist)
- [x] CRUD endpoints (`/v1/expenses` POST/GET/PUT/DELETE, `/v1/bootstrap`, `/v1/admin/*`)
- [x] D1 schema deployed (база `finances-outbox` — имя историческое)
- [x] launchd-агент `com.user.excel-sync.plist`
- [x] Smoke-test: трата с телефона доехала end-to-end

### Этап 2 — Mini App (UI ввода трат)
- [x] Mini App на Cloudflare Pages: numpad + сетка категорий с пагинацией + история
- [x] Мульти-валютность с флагами (EUR/USD/RUB/RSD/USDT)
- [x] Telegram WebApp API: `initData` авторизация
- [x] @BotFather: `setChatMenuButton` → Mini App URL
- [x] Пастельные цвета категорий (миграция 005)
- [x] iOS swipe-to-delete в Истории, edit-modal с CRUD
- [x] Унифицированные анимации через `--ease` / `--dur` CSS-vars
- [x] Direction lock на свайпе категорий (нет диагонального scroll)
- [x] Focus guard в edit modal: tap вне input → blur, не активирует чужой элемент
- [x] `interactive-widget=overlays-content` — нет layout-jump при клавиатуре

### Этап 4 — Импорт CSV из «Расходы ОК»
- [x] `local/scripts/import_ok_csv.py` — TSV парсер, UUID5 идемпотентность
- [x] Миграции 003 (источник-аккаунт + 7 категорий) и 004 (ещё 4 категории)
- [x] **1822 трат за 2024-01-10 → 2026-05-23, 7.78M RSD** — в D1

### D1-centric pivot (ADR-011)
- [x] D1 как единственный источник правды (1822 expenses, 32 категории, 5 валют, 2 счёта)
- [x] MacBook сведён к backup: `backup_d1.py` через `wrangler d1 export`, launchd раз в день
- [x] Удалены устаревшие: `sync.py`, `push_*.py`, `regenerate_xlsx.py`, `expenses_outbox`, `expenses_cache`, `device_heartbeats`, cron в Worker, `/v1/sync/*` endpoints

---

## 🔄 В работе

(пусто — Stage 2 закрыт, выбираем следующий)

---

## 📋 Дальше

### Этап 3 (переосмыслен) — Аналитика и курсы валют

После D1-centric pivot Excel/Google Sheets dashboard больше не нужен. Вместо него:
- [ ] Курсы валют автоматически из публичного источника (Frankfurter/ECB/CBR-XML/CoinGecko).
- [ ] Хранение курсов в D1 (новая таблица `rates`).
- [ ] В Mini App: конверсия в выбранную базовую валюту (EUR/RSD).
- [ ] Аналитика прямо в Mini App: pie-chart по категориям, столбцы по дням/неделям/месяцам, фильтры по периодам и валютам.
- [ ] Bottom-tab или вкладка «📊 Статистика» в меню.

### Этап 5 — Снапшоты и обмены через Mini App

Расширение модели от только-трат к полному финансовому учёту.

- [ ] D1 schema: `accounts` с полями для всех счетов (Сбер/Cash EUR/Биржи/Кошельки/...).
- [ ] D1 schema: `snapshots` (UUID + дата + account_id + native_amount + source).
- [ ] D1 schema: `transactions` (exchange/transfer/income/interest, from/to/amounts/rate/fee/chain_id).
- [ ] В Mini App: вкладка «💼 Счета» — снапшоты с возможностью записать «сегодня в Сбере X RUB».
- [ ] В Mini App: вкладка «🔄 Обмены» — UI для обмена валют с фиксацией курса.
- [ ] Цепочки (chain_id): связать RUB→USDT→EUR в одну операцию, показать total PnL.

### Этап 6 — Миграция Legacy

- [ ] Из текущего `data/legacy/Finances.xlsx` (33 снимка в EUR-eq) восстановить snapshots в нативных валютах.
- [ ] По историческим курсам ECB/CBR обратная конверсия EUR-eq → RUB/RSD/USDT/USD.
- [ ] Записать в D1 с `source = 'estimated_from_legacy'`.

### Этап 7 — Инвестиции

- [ ] Поле `yield_pct` на Account (уже в схеме).
- [ ] Автоматическая транзакция типа `interest` при ежемесячном начислении.
- [ ] Дашборд: ожидаемый доход за период.
- [ ] (когда появятся) Holdings: акции/ETF.

### Технический долг
- [ ] **#20**: переименовать корень с `excel/` → что-то осмысленное (`finance/`, `pfs/`, `ledger/`).
- [ ] Удалить мёртвый код в `tools/excel/` если Legacy будет полностью мигрирован.
- [ ] `init_db.py` + `migrate_to_d1.py` — больше не нужны после полной миграции, переместить в `legacy/scripts/` или удалить.

---

## Текущий этап

**Stage 2 закрыт.** Следующий этап выбирается из: 3 (курсы + аналитика), 5 (снапшоты + обмены), 6 (миграция Legacy), 7 (инвестиции).
