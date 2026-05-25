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

### Этап 3 — Курсы валют и аналитика в Mini App
- [x] Google Sheets-прокси (GOOGLEFINANCE) как источник курсов (ADR-006).
- [x] Worker pull + сохранение в D1 таблицу `rates`, cron раз в сутки.
- [x] Backfill исторических курсов (2024-01-10 → today, 3328 записей).
- [x] Конверсия в базовую валюту в Mini App (EUR/RUB/RSD).
- [x] Вкладка «📊 Статистика»: KPI + donut + список категорий + trend chart.
- [x] Drill-down по категориям.
- [x] Период picker (Нед / Мес / Год / Всё) + nav prev/next.
- [x] Playwright UI-тестер для iPhone 15 Pro Max.
- [x] Багфиксы: history pagination (lazy load), donut center без emoji, trend axis с осью времени.

### D1-centric pivot (ADR-011)
- [x] D1 как единственный источник правды (1822 expenses, 32 категории, 5 валют, 2 счёта)
- [x] MacBook сведён к backup: `backup_d1.py` через `wrangler d1 export`, launchd раз в день
- [x] Удалены устаревшие: `sync.py`, `push_*.py`, `regenerate_xlsx.py`, `expenses_outbox`, `expenses_cache`, `device_heartbeats`, cron в Worker, `/v1/sync/*` endpoints

### Web Admin pivot (ADR-012)
- [x] Решено: Mini App scope зафиксирован (расходы + аналитика расходов).
- [x] Решено: всё остальное (снапшоты, доходы, обмены, дашборды) → React-админка на Cloudflare Pages.
- [x] Стек выбран: React 19 + Vite + TanStack + shadcn/ui + ECharts.
- [x] Auth выбран: Google OAuth для allowlisted email (`ADMIN_ALLOWED_EMAILS`) → JWT в localStorage.

---

## 🔄 В работе

(Stage 6 — следующий: Доходы)

### Stage 4 — Web Admin Bootstrap — ✅ Закрыто
- [x] Worker: Google OAuth endpoints + JWT HS256 middleware + allowlist по email.
- [x] `cloud/admin/`: Vite + React 19 + TypeScript scaffold.
- [x] Tailwind + кастомные базовые компоненты + sidebar layout.
- [x] TanStack Router + Query setup.
- [x] Login page с Google sign-in.
- [x] `/expenses` страница — TanStack Table с поиском, фильтрами по периоду/категории/валюте.
- [x] Cloudflare Pages project `finances-admin`, deploy → `https://finances-admin.pages.dev`.
- [x] OAuth Client ID в GCP + wrangler secrets установлены.

---

## 📋 Дальше

### Этап 5 — Снапшоты счетов (Web Admin)

Модель: **«валюта × форма» (cash/digital)**, 7 вёдер: `rub-bank`, `rsd-bank`, `rsd-cash`, `eur-bank`, `eur-cash`, `usdt`, `try-cash`. Конкретный банк/биржа неважен. Снапшоты — event-driven (зарплата, обмен, подарок).

#### 5a (CRUD, без графиков) — ✅ Закрыто
- [x] D1 миграция 0006: `accounts.form` (cash/digital/external), `accounts.sort_order`, `accounts.deleted_at`. 6 новых вёдер + переименование `acc_money_ok_rsd` → «RSD · нал». Валюта TRY добавлена.
- [x] D1 schema: таблица `snapshots` (UUID, date, account_id, amount, note, source, soft-delete).
- [x] Worker: CRUD endpoints `/v1/web/accounts`, `/v1/web/snapshots` GET/POST/PUT/DELETE.
- [x] Web Admin: страница `/accounts` — 7 карточек с last balance + EUR-эквивалент + net worth + дата курсов.
- [x] Web Admin: страница `/snapshots` — таблица, поиск, фильтр по ведру, модал создания/редактирования с подсказкой «прошлый: X, дельта Y».
- [x] Sidebar активирован для Счета + Снапшоты.

#### 5b (графики) — после Stage 6/7 (нужно больше данных)
- [ ] Balance over time per bucket (step chart).
- [ ] Net worth over time (stacked area по форме / валюте).
- [ ] Sparklines на карточках в /accounts.

#### 5d (Legacy) — отложено
- [ ] Импорт snapshots из `data/legacy/Finances.xlsx` (33 снимка в EUR-eq) с обратной конверсией по историческим курсам. Решено начать с нуля.

### Этап 6 — Доходы (Web Admin)
- [ ] D1 schema: `incomes` (отдельная таблица) либо унификация в `transactions` с типом.
- [ ] Worker: CRUD endpoints.
- [ ] Web Admin: страница `/incomes` с категориями (зарплата, проценты, переводы, прочее).

### Этап 7 — Транзакции / обмены / цепочки (Web Admin)
- [ ] D1 schema: `transactions` (type: exchange/transfer/income/interest, from/to amounts, rate, fee, chain_id).
- [ ] Web Admin: builder цепочки (RUB→USDT→EUR одной операцией, фиксация курса, total PnL).
- [ ] Аналитика по обменам: эффективный курс, потери на спреде, PnL по периодам.

### Этап 8 — Главный дашборд (Web Admin)
- [ ] KPI карточки: net worth, monthly burn, runway, monthly income, savings rate.
- [ ] Time series: balance over time, expenses by category, income vs expenses.
- [ ] Multi-currency consolidation в base currency.
- [ ] Фильтры по периоду, по типу счёта, по категории.

### Этап 9 — Инвестиции
- [ ] Use `yield_pct` на Account: автоматическая транзакция `interest` ежемесячно.
- [ ] Дашборд: ожидаемый доход за период, реальный yield.
- [ ] (когда появятся) Holdings: акции/ETF, цены, P&L.

### Этап 10 — AI Coach (персональный финансовый советник)

LLM-агент с доступом ко всем финансовым данным пользователя, который шлёт инсайты в Mini App / Web Admin / Telegram-бота, ведёт диалог, проводит онбординг, замечает аномалии и предлагает действия.

**Каналы доставки:**
- В Web Admin — отдельный раздел `/coach` с историей инсайтов + интерактивный чат (как ChatGPT-окно).
- В Mini App — push-карточка «Совет недели» на стат-экране.
- В Telegram-бота — proactive `sendMessage` с инсайтами (бот уже есть и whitelisted).

**Типы коммуникации:**
- **Weekly digest** (каждый понедельник): «На прошлой неделе ты потратил X — это на 23% больше, чем обычно. Главная категория — рестораны (+40%). Если так продолжится, runway сократится до Y месяцев».
- **Anomaly alert**: разовая большая трата, нетипичная категория, рост в категории > порога — мгновенный пуш.
- **Missing-expenses reminder**: «Последняя трата 4 дня назад. Обычно ты вносишь ~3/день. Не забыл ли что-то записать?» (детект по гэпу относительно средней частоты).
- **Goal check-in**: «До цели X осталось 3 месяца, экономь Y/нед — успеешь».
- **Onboarding survey** (один раз + раз в N месяцев): набор вопросов о целях (накопить на X, переехать в Y, FI-цель), приоритетах (savings rate vs experiences vs investments), предпочтениях по советам (стоический / агрессивный / мягкий тон).
- **Free-form chat в Admin**: «почему мои расходы на кафе выросли», «покажи где я переплачиваю», «куда лучше положить N EUR при моих текущих остатках».

**Архитектура (черновик):**
- LLM: Claude API (тот же `claude-opus-4-7` / `claude-sonnet-4-6` по задаче). Anthropic API key как новый Worker secret `ANTHROPIC_API_KEY`.
- D1: новая таблица `coach_messages` (id, kind, channel, body, status, created_at, delivered_at, user_reaction).
- D1: таблица `coach_profile` (онбординг-ответы, цели, preferences) — single-row или key-value.
- D1: таблица `coach_surveys` (id, question, answer, asked_at, answered_at).
- Worker cron расширяется: weekly digest по понедельникам, daily missing-expenses check.
- Worker endpoint `/v1/coach/chat` для интерактива из Admin (streaming через SSE).
- Tool use: LLM может вызвать "tool" `query_expenses(filter)`, `query_snapshots(from, to)`, `compute_metric(name)` — типобезопасные обёртки над D1.
- Контекст для LLM: компактный JSON-снимок профиля + последние 90 дней агрегатов + история советов за месяц (для непротиворечивости).

**Опросы (onboarding survey):**
- Первый запуск Admin: модальный wizard.
  - Какие цели? (free text + tags: накопления / переезд / инвестиции / freedom)
  - Горизонт цели?
  - Tolerance к риску?
  - Чему хочется чтобы я (AI) уделил больше внимания: контроль трат / рост сбережений / оптимизация налогов?
  - Какой стиль советов: жёсткий / поддерживающий / факт-онли?
- Раз в 3 месяца — re-check: цели поменялись? приоритеты? +впитать недавнюю активность.

**Безопасность и приватность:**
- API key только на Worker, никогда в клиент.
- LLM запрос содержит обезличенные суммы и категории, не «зарплата от X в Y банке».
- Сохранение всех LLM-промптов в `coach_messages` для отладки + ретроанализа.
- Rate-limit: max N запросов в день в free-form chat.

**Бюджет:**
- Personal scale: ~50 weekly digest + ~100 chat-сообщений/мес = ~$5-15/мес API.
- При желании — переключить на `claude-haiku-4-5` для дешёвых рутинных задач, `opus` только для глубокого анализа.

**Требует завершения этапов 5-7** (нужны snapshots + transactions + incomes для богатого контекста). Можно начать прототип сразу после Stage 5 если хватит данных только по расходам.

### Технический долг
- [ ] **#20**: переименовать корень с `excel/` → `finance/` (или `ledger/`).
- [ ] Удалить мёртвый код в `tools/excel/` если Legacy полностью мигрирован в snapshots.
- [ ] `init_db.py` + `migrate_to_d1.py` — переместить в `legacy/scripts/` или удалить.
- [ ] Опционально: переезд Worker в Pages Functions для same-origin (упрощает auth, убирает CORS).

---

## Текущий этап

**Stage 4 (Web Admin Bootstrap) — в работе.** Mini App в режиме «полировка по запросу», большая инженерная работа — на стороне Web Admin.
