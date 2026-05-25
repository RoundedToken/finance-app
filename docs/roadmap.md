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

(Stage 7.5 — следующий: Транзакции/обмены)

### Stage 7 — Цели / целевые фонды — ✅ Закрыто
- [x] D1 миграция 0008: `goals` (name, emoji, color, target_amount?, target_currency?, deadline?, status: active/achieved/archived, soft-delete) + `goal_contributions` (manual ledger, amount>0) + ALTER `incomes` ADD `goal_id`.
- [x] Worker: 9 endpoints под `/v1/web/goals*` и `/v1/web/goal-contributions*` + интеграция `goal_id` в incomes CRUD. Cascade delete goal через atomic D1 batch (soft-delete goal + NULL incomes.goal_id + soft-delete contributions).
- [x] Web Admin: `/goals` — карточки целей с emoji/color/прогрессбаром/дедлайном; tabs Активные/Достигнутые/Архив; модал create+edit (через shared `GoalFormModal`). `/goals/:id` — header с edit+menu, прогресс-блок, таблица contributions (mixed source: income + manual badge). IncomeModal — селект «Цель» (загружает all goals чтобы не терять achieved). AccountsPage Net worth раскладывается на «Свободно / Целевые фонды».
- [x] Phase 3 audit fallback не понадобился — оба subagent'а прошли с verdict PASS_WITH_SHOULDS / APPROVED_WITH_SHOULDS. 9 follow-up фиксов применены тем же спринтом.
- [x] Sidebar активирован для «Цели» (иконка `Target`); active-state работает для `/goals/:id` через startsWith match.

### Stage 6 — Доходы (Web Admin) — ✅ Закрыто
- [x] D1 миграция 0007: `income_categories` (6 базовых: salary, interest, gifts, cashback, freelance, other) + `incomes` (UUID, date, account_id, amount, currency_code, category_id, source, note, soft-delete, CHECK amount>0).
- [x] Worker: CRUD `/v1/web/incomes` GET/POST/PUT/DELETE + `/v1/web/income-categories` GET. Pre-INSERT валидация FK (account_id, category_id existence). currency_code денормализуется из accounts.currency на write; на PUT — пересчёт при смене account_id (COALESCE pattern).
- [x] Web Admin: страница `/incomes` — 3 KPI (этот месяц / 12 мес / всё время в EUR), breakdown by category (горизонтальные бары с %), таблица с поиском/фильтром по категории/периоду, модал create/edit с кнопкой «⎘ Из последней» (pre-fill из самой свежей записи выбранной категории).
- [x] Sidebar активирован для «Доходы» (`TrendingUp` icon).
- [x] Phase 3 audit fallback: senior-qa + solution-architect agents трижды упали с 529 Overloaded → self-audit с явным disclaimer. Verdict: PASS_WITH_NICES / APPROVED_WITH_NICES, 0 must-fix, 1 should-fix (catById helper duplication, починен сразу). См. `specs/audits/SPEC-006-{qa,arch}.md`.

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

### Этап 7.5.1 — Симметрия auto-snapshot для incomes / expenses

(Идея от пользователя 2026-05-25, см. SPEC-008 §11 OQ3.)

Если auto-snapshot работает для transactions, логично распространить
на incomes и expenses: каждая денежная операция меняет balance ведра,
и system всегда держит computed net worth актуальным. Quarterly /
manual snapshot тогда становится **сверкой** против фактической
банк-выписки — расхождение указывает на скрытую комиссию / процент /
ошибку учёта.

Что предстоит:
- [ ] Helper `applyDelta(env, account_id, date, delta, source_ref)` —
  единая точка генерации auto-snapshot. Используется
  transactions / incomes / expenses.
- [ ] Migrate incomes CRUD на auto-snapshot (insert/update/delete →
  batch со snapshot mutation).
- [ ] Migrate expenses CRUD аналогично (1822 существующих записей —
  backfill миграцией: один snapshot за каждую expense ИЛИ
  aggregated-by-day для compactness).
- [ ] FK `snapshots.income_id` и `snapshots.expense_id` (nullable, для
  cascading soft-delete как у transactions).
- [ ] Retroactive операции: protocol пересчёта computed balance для
  снапшотов «после» — либо invalidate, либо recompute.
- [ ] UI: на bucket card показывать drift между computed и last manual
  snapshot («-12 EUR расхождение — внести фактический baланс?»).

### Этап 7.5.5 — Remove chains + goal-tagged tx — ✅ Закрыто
- [x] Чейны и привязка transactions к целям убраны (SPEC-008 частично + SPEC-009 полностью откатаны). После реальной попытки использования: spread loss в goal balance и multi-step builder оказались шумом без actionable insight'а.
- [x] Worker: endpoints `/v1/web/chains*` и `/v1/web/transactions/:id/chain-from` удалены. `createChain`, `getChainDetail`, `deleteChain`, `chainFromTransaction` helpers ушли. `validateStep` больше не валидирует `goal_id`. `getGoalDetail` timeline и `listGoals` balance — только incomes + manual contributions.
- [x] Admin: `ChainModal`, `ChainContinueModal`, `ChainDetailPage` файлы удалены. Кнопки `+ Цепочка` и `🔗 Продолжить` ушли с /transactions. Goal selector убран из Exchange/Transfer/Edit modals. Маршрут `/chains/$chainId` удалён.
- [x] D1 data fix: `UPDATE transactions SET goal_id=NULL, chain_id=NULL, chain_sequence=NULL` (2 rows) — на чистый слой данных.
- [x] Колонки в таблице сохранены как «спящие» — никаких миграций нет, на случай возврата фичи в будущем.
- См. `specs/SPEC-012-remove-chains-and-goal-tagged-tx.md`.

### Этап 7.5.4 — Math consistency (manual + events) — ✅ Закрыто
- [x] Auto-snapshots полностью убраны из системы (миграция 0010 hard-DELETE для существующих, генерация снята в transactions.ts).
- [x] `getEffectiveBalance(account, asOfDate?)` = manual baseline + Σ events (incomes, expenses, transactions, goal_contributions) после baseline.
- [x] `/v1/web/accounts` возвращает `effective_balance` + `manual_snapshot` + `events_count`.
- [x] Overdraft validation: создание tx / chain / edit с уменьшением bucket'а ниже 0 — 400 с конкретными цифрами «доступно X, нужно Y».
- [x] AccountsPage: bucket card показывает effective balance + manual baseline + drift indicator («+X от событий») + warning «нет baseline» если manual snapshot отсутствует. Топ-баннер если есть отрицательные вёдра.
- [x] SnapshotsPage: создание/редактирование manual snapshot — он становится новым baseline для всех будущих расчётов.
- См. `specs/SPEC-011-math-consistency.md`.

### Этап 7.5.3 — Edit transaction — ✅ Закрыто
- [x] PUT `/v1/web/transactions/:id` partial update. Standalone tx — все поля; chain-tx — только note/fee/goal_id (структурные изменения требуют delete+recreate).
- [x] Auto-snapshots пересчитываются в atomic batch при structural change (UPDATE tx + soft-delete старых snapshots + INSERT новых с правильным prev_balance).
- [x] Admin: Pencil button на TxRow → EditTxModal с pre-fill; для chain-tx structural поля disabled + amber warning.
- См. `specs/SPEC-010-edit-transaction.md`.

### Этап 7.5.2 — Goal-tagged transactions + saga workflow — ✅ Закрыто
- [x] `transactions.goal_id` теперь populated в UI (Exchange / Transfer / Chain modals), валидируется в Worker, пробрасывается на все steps цепочки (mixed-goal chains rejected).
- [x] `listGoals` / `getGoalDetail` пересчитывают balance с учётом `+to − from` (in target_currency) — spread loss явно отображается на goal-detail timeline отдельной колонкой «Δ цели».
- [x] Shared `<GoalSelector>` в `src/components/` (refactor: IncomesPage больше не имеет inline definition).
- [x] Endpoint `POST /v1/web/transactions/:id/chain-from` — workflow «Продолжить цепочку»: если source tx не в chain — создаёт chain и обновляет source's chain_id=new + sequence=1, новое звено получает sequence=2; если уже в chain — добавляет sequence=max+1. Inherits source.goal_id.
- [x] Admin SPA: TxRow имеет кнопку 🔗 «Продолжить цепочку», открывает `ChainContinueModal` с заполненным `from = source.to_*`. Goal наследуется автоматически.
- [x] GoalDetailPage timeline отображает tx-rows c source `exchange`|`transfer`, ссылка на /transactions, badge chain.

### Этап 7.5 — Транзакции / обмены / цепочки — ✅ Закрыто
- [x] D1 миграция 0009: `transactions` (exchange/transfer + chain_id + chain_sequence + fee + nullable goal_id) + `snapshots.transaction_id` (cascade FK).
- [x] Worker: 6 endpoints CRUD (transactions + chains) + atomic batch (tx + 2 auto-snapshots в одном batch; для chain — все 3N statements в одном batch с virtual-delta map для корректного prev_balance).
- [x] Web Admin: `/transactions` с PeriodPicker + 3 модала (exchange / transfer / chain builder с N звеньями), `/chains/:id` detail с initial/final/effective_rate. Auto-snapshots видны на /snapshots с бэйджем «auto», edit/delete блокированы (cascade-инвариант).
- [x] Sidebar активирован для «Обмены» (`ArrowRightLeft`).
- [x] Helper `formatExchangeRate()` — естественное направление display («1 USDT = 82.50 RUB», не «1 RUB = 82.5 USDT»).
- [x] Phase 3 audit. QA PASS_WITH_SHOULDS (1 M, 5 S, ~5 N), Arch APPROVED_WITH_SHOULDS (0 M, 6 S, 4 N). Применены: chain atomicity (M1), transfer amount validation, loadAccount is_active check, snapshot OR IGNORE, listSnapshots transaction_id, SnapshotsPage auto-badge + read-only.

### Этап 7.5.0 — отложенные пункты SPEC-008 audit
- [ ] **Chain idempotency uniqueness** — `UNIQUE(chain_id, chain_sequence)` constraint в миграции 0009.1, чтобы повторный POST с тем же `chain_id` гарантированно не дублировал звенья.
- [ ] **AC19 — «N обменов в этом месяце»** на bucket card в `/accounts` (требует подписки `useTransactions` в AccountsPage).
- [ ] **AC9 UI warning** — на BucketCard показывать «баланс начат с обмена — проверь корректность» если первый snapshot is `auto_transaction` и prev_balance=0.
- [ ] **data-model.md update** — описать `transactions`, `goal_contributions`, `goals`, обновить раздел snapshots.
- [ ] **Currency conversion: date-aware rate** (см. ответ пользователю про rates) — `loadRatesForDate(date)` вместо `loadRates()` для historical accuracy в goal balance / KPI. Performance impact: N+1 lookup → cache по batch'у.

### Этап 8 — Главный дашборд + историческая аналитика обменов
(см. Stage 8 ниже — аналитика по обменам перенесена туда.)

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

#### Из retrospective audits (`specs/audits/SPEC-00*-{qa,arch}.md`)

Найдено senior-qa + solution-architect agents после написания retro spec'ов. Must-fix применены отдельными commit'ами; ниже — nice-to-have. Каждый пункт можно вытащить в отдельный mini-spec когда дойдём.

**Worker / Backend:**
- [ ] Серверная валидация payload'ов в `POST/PUT /v1/expenses` и `/v1/web/snapshots` — сейчас минимум, missing required → 500 с leak'ом стек-трейса в response. Внедрить тонкий zod-слой (или ручной guard) → 400 с осмысленным сообщением. (QA-001, QA-005, ARCH-005-NTH3) Stage 6 incomes уже имеет тонкий ручной guard — взять за образец.
- [ ] **SPEC-006 N1**: `createIncome` делает 2 round-trip к D1 (lookupAccountCurrency + categoryExists) перед INSERT. Объединить в один SELECT/CTE для рукопожатий. Personal scale ok, но в Stage 7 (transactions) объёмы будут больше.
- [ ] **SPEC-006 N6**: deactivation logic непоследовательна между доменами — `accounts.deleted_at IS NULL` vs `categories.is_active = 1` vs `income_categories.is_active = 1`. Унифицировать в Stage 7-8.
- [ ] **SPEC-006 OQ1**: PUT /v1/web/incomes/:id с новым `account_id` другой валюты — сейчас amount сохраняется как есть, currency_code пересчитывается. Это потенциальное «100000 RUB вдруг стало 100000 EUR» — добавить guard или confirm в UI. Risk при изменении ведра между валютами.
- [ ] `500 → String(err)` утечка — `index.ts:113`. Заменить на generic message + structured log. (ARCH-001, ARCH-005)
- [ ] `auth_date` freshness не проверяется в initData — токен валиден вечно до ротации bot token. OK для single-user, must-fix для multi-user. (QA-001)
- [ ] `bot.ts` `parseExpense` принимает любой 3-5 буквенный токен как currency без проверки против `currencies` таблицы. (ARCH-001)
- [ ] Telegram webhook без `secret_token` header — полагаемся на URL obscurity + whitelist. (ARCH-001)
- [ ] `listExpenses` не фильтрует по `user_id` — fine для single-user, data-leak risk для multi-user. (QA-001)
- [ ] `limit` парсится без валидации — `?limit=abc` → `LIMIT NaN`. (QA-001)
- [ ] `/healthz` принимает любой HTTP method. (QA-001)
- [ ] `latestSnapshotPerAccount` query использует `MAX(date || '|' || created_at)` — не использует индекс. Переделать на `ROW_NUMBER() OVER PARTITION` когда дойдём до Stage 5b. (ARCH-005)
- [ ] `/v1/admin/bulk-rates` без cap на размер массива и per-item validation. (ARCH-003)
- [ ] Миграция 0005 содержит stale "open-er-api" комментарии; index `DESC` qualifier mismatch с `schema.sql`. (ARCH-003)
- [ ] `getRateAt` и `GET /v1/rates` существуют, но нет caller'а в Stage 3 — задокументировать назначение или удалить. (ARCH-003)
- [ ] `tie-breaker` snapshots по `created_at` имеет точность секунды — при двух POST в одну секунду результат недетерминирован. (QA-005)

**Mini App:**
- [ ] **Donut tap unreliable** — Playwright кликает в bbox center и попадает в null fill. Реальный палец на stroke работает. Сделать arc `<path fill="..."/>` или добавить transparent overlay. (QA-003 M1)
- [ ] A11y: добавить `aria-label` на `.back-btn`, `#open-date`, `#open-note`, `data-key="back"/"dot"`, `.iconbtn`. Toast → `role="status" aria-live="polite"`. (QA-002, QA-003)
- [ ] CSP отсутствует в Mini App. Telegram WebView, но всё равно ослабляет defense-in-depth. (QA-002)
- [ ] `escapeHtml` не экранирует `'` — текущая разметка safe, fragile к будущим изменениям. (ARCH-002)
- [ ] Магические числа в `app.js`: swipe threshold 0.18, REVEAL/OPEN_AT 64/28, max amount 12, setTimeout 50/300/320/340. Вытащить в const с комментариями. (ARCH-002)
- [ ] Эмодзи полей категорий/валют (`c.emoji`, `cat.emoji`) не экранируются в 8 местах — D1-admin-injection vector если SYNC_TOKEN утечёт. (QA-002)
- [ ] Можно перейти с `confirm()` на `tg.showConfirm()` для нативного iOS look. (ARCH-002)
- [ ] Low contrast: `today` trend bar (`#c4b5fd` vs `#a78bfa`), "Прочее" donut (`#5a5378` vs track `#36315a`). (QA-003)
- [ ] Telegram WebApp warnings в Playwright логах загрязняют 0-errors gate — добавить `version: "7.10"` в mock. (QA-003)

**Web Admin:**
- [ ] `SnapshotsPage.tsx` — `useMemo` использован для side-effects (ре-инициализация модала). Переделать на `key`-pattern или `useEffect`. (ARCH-005 NTH-1) В IncomesPage уже сделано через useEffect, взять как образец.
- [ ] **SPEC-006 N5**: `pluralize(n)` для «доход/дохода/доходов» — локальная функция в `IncomesPage.tsx`. Вытащить в `lib/i18n.ts` если появятся другие плюрализации.
- [ ] **SPEC-006 N3**: TypeScript contract drift между worker `IncomePayload` и admin `IncomeCreatePayload`. Shared schema через `zod` или OpenAPI gen (общая тема для всего проекта).
- [ ] Plain-text 4xx OAuth-ошибки (`forbidden`, `bad state`, `invalid return_to`). UX-error page — отложен в Stage 8. (QA-004)
- [ ] Нет toast / ErrorBoundary. (QA-004)
- [ ] Sidebar `disabled` элементы — `<div>` вместо `aria-disabled` button. (QA-004)
- [ ] `BucketCard` hover-only иконка ArrowUpRight без visible affordance для keyboard users. (QA-004)
- [ ] `jwt.ts:38` — `!==` для HMAC compare. Constant-time compare для defense-in-depth. (ARCH-004)
- [ ] `jwt.ts` не валидирует header `alg`/`typ` явно — структурно блокируется HMAC-verify, но defence-in-depth. (ARCH-004)

**Test tooling:**
- [ ] `test_ui.py` — добавить `socketserver.TCPServer.allow_reuse_address = True` (port leak при re-run). (QA-002, QA-003)
- [ ] `test_ui.py` mock-clock pinning + selector by data-attribute (вместо nth-child). (QA-003)
- [ ] `test_ui.py` mock Telegram WebApp `version: "7.10"`. (QA-003)

**Process / Audit independence:**
- [ ] **SPEC-006 audit redo**: 2026-05-25 senior-qa + solution-architect agents пять раз падали с `529 Overloaded` от Anthropic API. Self-audit был fallback (`Auditor: claude-opus-4-7 (self)`). Пересмотреть SPEC-006 независимыми agent'ами когда API стабилизируется. Полные reports: `specs/audits/SPEC-006-{qa,arch}.md`.

**Из retrospective audits SPEC-007 (`specs/audits/SPEC-007-{qa,arch}.md`)**

Stage 7 audit verdict — PASS_WITH_SHOULDS / APPROVED_WITH_SHOULDS. 9 should-fix
применены тем же спринтом; остальные перенесены сюда.

- [ ] **Edit Contribution UI** (QA S2) — в `GoalDetailPage.tsx` ContribRow рендерит только Trash, нет `Pencil` для редактирования manual contribution. `useUpdateContribution` hook есть, не используется.
- [ ] **isError state на pages** (QA S8) — `GoalsPage`/`GoalDetailPage` показывают пустоту при 5xx; нужен баннер «Не удалось загрузить, попробуй обновить».
- [ ] **Net worth split currency-mismatch goals** (QA S9 / Arch OQ3) — goal без `target_currency` суммируется в Net worth как EUR без конверсии. Решить: либо enforce target_currency required на backend (R3 в spec), либо считать balance по списку валют без агрегации.
- [ ] **data-model.md** (Arch S5) — не описывает таблицы goals/goal_contributions; нужно добавить раздел Stage 7.
- [ ] **listGoals + getGoalDetail балансы — 2-3 query** (Arch NTH) — приемлемо для personal scale, но при росте имеет смысл вынести в materialized aggregates когда дойдём до Stage 8 Dashboard.
- [ ] **OQ1 SPEC-007** — currency drift при многовалютных contributions. Сейчас показываем `balance_missing_rates` counter. Решить policy при появлении prod-данных.
- [ ] **OQ2 SPEC-007** — UI warning при создании goal с deadline в прошлом (backend разрешает retroactive).

---

#### Прочее

- [ ] **#20**: переименовать корень с `excel/` → `finance/` (или `ledger/`).
- [ ] Удалить мёртвый код в `tools/excel/` если Legacy полностью мигрирован в snapshots.
- [ ] `init_db.py` + `migrate_to_d1.py` — переместить в `legacy/scripts/` или удалить.
- [ ] Опционально: переезд Worker в Pages Functions для same-origin (упрощает auth, убирает CORS).

---

## Текущий этап

**Stage 7.5 (Транзакции/обмены/цепочки) — ✅ закрыт 2026-05-25.** Реализовано: exchange + transfer + chain builder, auto-snapshot обоих ведер (atomic batch), cascade soft-delete. Следующий — Stage 7.5.1 (симметрия auto-snapshot для incomes/expenses, идея пользователя) или Stage 8 (Dashboard).
