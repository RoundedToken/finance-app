# Roadmap

Что сделано, что в работе, что впереди. Обновляется по факту.

---

## ✅ Завершено

### Stage 0 — Инфраструктура и документация
- Структура директорий (`data/`, `local/`, `cloud/`, `docs/`, `tools/`, `reports/`).
- Архитектурная документация (`docs/*.md`, корневой `CLAUDE.md`, ADR-001…013).
- Excel-инспекционные tools в `tools/excel/` (12 утилит).
- Python 3.13 в `.venv/`, Node + npm + wrangler глобально.
- Cloudflare-аккаунт + Telegram bot через @BotFather.
- D1 база `finances-outbox` (имя историческое), Cloudflare Worker (TypeScript), Pages для Mini App.
- Public GitHub repo `RoundedToken/finance-app`. gitleaks pre-commit, custom subagents (`senior-qa`, `solution-architect`).

### Stage 1 — End-to-end минимальная цепочка
- Worker `/tg` webhook + Telegram bot (silent для не-whitelist, ADR-009).
- CRUD `/v1/expenses` GET/POST/PUT/DELETE, `/v1/bootstrap`, `/v1/admin/*`.
- launchd-агент `com.user.excel-backup.plist` для daily D1 export.

### Stage 2 — Mini App (UI ввода трат)
- Numpad + сетка категорий с пагинацией + история.
- Мульти-валютность с флагами (EUR/USD/RUB/RSD/USDT).
- Telegram WebApp API: `initData` HMAC.
- @BotFather: `setChatMenuButton` → Mini App URL.
- iOS swipe-to-delete, edit-modal с CRUD.
- Унифицированные анимации через CSS-vars; direction lock на свайпе.

### Stage 3 — Курсы валют и аналитика в Mini App
- Google Sheet «Finance Rates» с формулами `=GOOGLEFINANCE(...)` (ADR-006).
- Worker cron `0 6 * * *` тянет CSV → D1 `rates(date, base='EUR', quote, rate)`.
- Backfill 2024-01-10 → today (4179 записей, **TRY добавлен 2026-05-25**).
- Вкладка «📊 Статистика»: KPI + donut + trend chart + drill-down.
- PeriodPicker (Нед/Мес/Год/Всё) + nav prev/next.

### Stage 4 — Импорт CSV из «Расходы ОК»
- `local/scripts/import_ok_csv.py` — TSV парсер, UUID5 идемпотентность.
- Миграции 003 + 004 (категории) + 005 (rates).
- **1822 трат за 2024-01-10 → 2026-05-23, 7.78M RSD** в D1.

### D1-centric pivot (ADR-011)
- D1 как единственный источник правды.
- MacBook сведён к backup: `backup_d1.py` через `wrangler d1 export`, launchd раз в день.
- Удалены устаревшие: `sync.py`, `push_*.py`, `regenerate_xlsx.py`, `expenses_outbox`, `expenses_cache`, `device_heartbeats`, cron в Worker, `/v1/sync/*` endpoints.

### Web Admin pivot (ADR-012)
- Mini App scope зафиксирован (расходы + аналитика).
- Всё остальное (снапшоты, доходы, обмены, цели, дашборд) → React-админка на Cloudflare Pages.
- Стек: React 19 + Vite + TanStack + Tailwind + Lucide + ECharts. Auth: Google OAuth → JWT HS256.

### Spec-driven workflow (ADR-013)
- `docs/process.md` — 4-фазный pipeline (Discovery+Spec → Implementation → Test+Review parallel → Push).
- `specs/SPEC-template.md` + retro SPEC-001..005 + 10 audits в `specs/audits/`.
- `.claude/agents/senior-qa.md`, `.claude/agents/solution-architect.md`.
- gitleaks `.githooks/pre-commit`, `wrangler.toml` в .gitignore, `wrangler.example.toml` как public template.

### Stage 4 (Admin) — Web Admin Bootstrap (SPEC-004)
- Worker: Google OAuth endpoints + JWT HS256 middleware + allowlist по email (`ADMIN_ALLOWED_EMAILS`).
- `cloud/admin/`: Vite + React 19 + TS scaffold; Tailwind; TanStack Router/Query; Login page.
- `/expenses` страница read-only с поиском + фильтрами (TanStack Table).
- Cloudflare Pages project `finances-admin` → `https://finances-admin.pages.dev`.

### Stage 5a — Снапшоты счетов (SPEC-005)
- Модель **«валюта × форма»**, 7 вёдер: `rub-bank`, `rsd-bank`, `rsd-cash`, `eur-bank`, `eur-cash`, `usdt`, `try-cash`.
- D1 миграция 0006: `accounts.form/sort_order/deleted_at` + 6 новых вёдер + TRY валюта.
- D1: таблица `snapshots` (UUID, date, account_id, amount, note, source, soft-delete).
- Worker: CRUD `/v1/web/accounts`, `/v1/web/snapshots`.
- Web Admin: `/accounts` (карточки) + `/snapshots` (таблица, модал, подсказка «прошлый baseline»).

### Stage 6 — Доходы (SPEC-006)
- D1 миграция 0007: `income_categories` (6 базовых) + `incomes` (CHECK amount>0).
- Worker: CRUD `/v1/web/incomes` + `/v1/web/income-categories`.
- Web Admin: страница `/incomes` — KPI (мес/12мес/всё) + breakdown by category + таблица + модал с «⎘ Из последней».

### Stage 7 — Цели / целевые фонды (SPEC-007)
- D1 миграция 0008: `goals` (target?+deadline?+emoji+color+status) + `goal_contributions` + `incomes.goal_id` (FK).
- Worker: CRUD `/v1/web/goals*` + `/v1/web/goal-contributions*`. Cascade delete goal через atomic D1 batch.
- Web Admin: `/goals` — карточки с прогрессом, tabs Активные/Достигнутые/Архив; `/goals/:id` — header с edit, прогресс-блок, таблица contributions. AccountsPage Net worth split «Свободно / Целевые фонды».
- Audit verdicts: PASS_WITH_SHOULDS / APPROVED_WITH_SHOULDS, 0 must-fix.

### Stage 7.5 — Транзакции / обмены (SPEC-008 + SPEC-010)
- D1 миграция 0009: `transactions` (exchange/transfer + nullable fee).
- Worker: CRUD `/v1/web/transactions` с overdraft validation, atomic UPDATE с recompute.
- Web Admin: `/transactions` с PeriodPicker + 2 модала (Обмен, Перевод) + EditTxModal. `formatExchangeRate()` helper для естественного направления курса.
- Edit transaction (SPEC-010): PUT endpoint, partial update, Pencil кнопка на TxRow.

### Stage 7.5.4 — Math consistency (SPEC-011)
**Корневой fix всей математики**: auto-snapshots полностью убраны как concept.
- Миграция 0010: hard-DELETE existing `source='auto_transaction'` snapshots.
- `effective_balance(bucket, asOfDate?)` = `last_manual_snapshot + Σ events`. Worker `snapshots.ts:getEffectiveBalance`.
- Events: incomes (+), expenses (−), transactions (−from/+to), goal_contributions (+).
- Overdraft validation: tx/edit с уходом < 0 → 400 «доступно X, нужно Y».
- AccountsPage: bucket card показывает `effective_balance` крупно + manual baseline + drift indicator + warning «нет baseline» если manual отсутствует. Топ-баннер если негативные вёдра.
- Goals timeline / balance — было event-based уже, не менялось.

### Cross-cutting UI/UX
- **PeriodPicker** (Mini App-style segmented control): Нед/Мес/30д/Год/Всё/Период + ‹nav›. Применён в Incomes/Expenses/Transactions.
- **Currency component** (`<Currency code="EUR" />`): флаг + muted код, без bold. Везде в Admin.
- **Select wrapper** с custom `ChevronDown` (нативный arrow обрезался).
- **Modal**: scrollable на коротких viewport'ах, backdrop `position: fixed` (не съезжает при скролле), sticky header.
- **Goal forms**: live preview карточки + единая `Эмодзи и цвет` секция + skрытые number stepper arrows.
- **Rate display**: `formatExchangeRate()` — `1 USDT = 82.5 RUB`, не наоборот.
- **Date format**: `dd.mm.yyyy` (компактно, без переносов в узких колонках).
- **Sidebar active state**: `useRouterState` (был snapshot — застревал).
- **Memory rules**: visual UI testing перед report-as-done (`feedback_visual_ui_testing.md`), git push через `gh auth git-credential`.

### Stage 8 — Главный дашборд (SPEC-013)
- Worker `GET /v1/web/dashboard` (`dashboard.ts`): батч-агрегация (~11 D1-запросов вместо сотен), in-memory date-aware конверсия EUR (`RatesIndex.rateAt` = курс на дату/конец месяца), все KPI + серии. Без миграций.
- KPI: net worth (+split Свободно/Целевые), monthly burn/income (среднее за 3 полных мес), savings rate, runway (по свободным + полный в подписи).
- Web Admin `DashboardPage`: блок «Сейчас» (5 KPI) + «История за период» (ECharts: net worth over time с toggle форма/валюта, income vs expenses bars, donut категорий) + пресеты 12м/6м/Год/Всё/Период + фильтры форма/категория.
- Math зеркалит SPEC-011 (`balanceAt` ≡ `getEffectiveBalance`). Audit: solution-architect APPROVED_WITH_NICES, senior-qa PASS_WITH_NICES, 0 блокеров. Fix-commit: missing_rates (E3 + убран double-count), D6 пересчёт долей легенды.

### Stage 8.5 — Дашборд v2: линза / прогресс / прогноз (SPEC-015)
- Тумблер линзы «Свободные ↔ Со всеми фондами» (дефолт — свободные): переключает Net worth / Runway / Доход / Норму. Под каждым KPI — подпись, что входит. Worker: free/prev KPI-поля (`monthly_income_free_eur`, `savings_rate_free`, `prev_*`); `income_free` = доход без goal-помеченного.
- Прогресс: Δ-бейджи к предыдущему 3-мес окну (цвет по смыслу), спарклайны в KPI из существующих series.
- Прогноз: пунктир-проекция net worth (длина адаптивна — ~половина истории, в пределах [3..12] мес, по темпу свободных сбережений); блок «Цели — прогноз достижения» (ETA-дата + сравнение с дедлайном, прогресс-бары). test_admin_ui — обе линзы + ETA + 6-мес адаптация проекции проверены.

### SPEC-016 — Канонический слой конвертации валют
- **Модель двух классов** (ADR-014): запас (вёдра / net worth / goal balance) → курс на сегодня (mark-to-market); поток (расход / доход / day-total) → курс на дату операции (date-aware). Вся конверсия — на worker через `RatesIndex`, клиент не делит на курс, получает `*_eur`.
- Worker: `RatesIndex.convertAt`; `goals.ts` `loadRates(MAX date)`→`convertAt(today)`; `listExpenses` + `getBootstrapData` отдают `amount_eur` date-aware; `/accounts` → `effective_balance_eur` + `summary{net_worth,free,targeted,missing_rates,rates_date}`.
- Клиент: AccountsPage / ExpensesPage / Mini App `DayTotal` больше не конвертируют; `lib/money.ts` (latest `toBase`) удалён. Без миграций D1.
- Фикс-эффект: RUB-вёдра/цели больше не дают 0 при устаревшем курсе (per-quote `rateAt` вместо глобального `MAX(date)`-snapshot); EUR-эквивалент трат стал историчным. Audit: solution-architect APPROVED_WITH_NICES, senior-qa PASS_WITH_NICES (must-fix — устаревший мок `test_admin_ui`, исправлен). test_admin_ui + test_miniapp_react проверены (скриншоты: net worth N €, split, EUR-колонки, day-total RUB→EUR date-aware).

### SPEC-017 — Управление категориями + завершение canonical toEur
- **CRUD категорий в Web Admin** (`/categories`): расходные (`categories`) + доходные (`income_categories`) — создать / переименовать / эмодзи / цвет / порядок (↑↓) / мягкая деактивация (`is_active=0`, история цела). Только Admin; Mini App отражает через bootstrap (правило 11).
- Worker: модуль `categories.ts` (CRUD обеих таблиц) + endpoints `/v1/web/categories` (GET/POST/PUT), `/v1/web/income-categories` (POST/PUT + GET `include_inactive`). Без миграций D1.
- **Добит residual `toEur`**: `IncomesPage` (→ `amount_eur`) и `DashboardPage` goals-forecast (→ worker-поля `balance_eur`/`target_amount_eur` в `listGoals`). Canonical-инвариант (ADR-014) теперь глобальный — клиентской latest-конверсии не осталось.
- test_admin_ui — сценарий `/categories` (табы, список, ↑↓, деактивация) проверен скриншотом.

### SPEC-020 — Бюджеты / лимиты по категориям (пост-MVP Фаза 2, пункт 2.2)
- **Поведенческая петля «сколько ещё можно потратить»**: месячный лимит в EUR на расходную категорию (`scope='category'`) + опциональный общий потолок на все траты (`scope='total'`). Recurring, без истории по месяцам; факт трат — derived (не хранится).
- D1 миграция 0011: таблица `budgets` (scope/category_id FK/limit_eur REAL/soft-delete + 2 partial unique-индекса + CHECK когерентности). Факт = Σ `RatesIndex.toEurAt` date-aware за календарный месяц (как donut), пороги good`<80%`/warn`80–100%`/over`>100%` считаются на worker (единый источник `budgetStatus`, переиспользован эндпоинтом + bootstrap).
- Worker: `budgets.ts` (`computeBudgetProgress` чистая + CRUD), `/v1/web/budgets` GET/POST/PUT/DELETE (JWT) + `budgets` в `/v1/bootstrap` (read-only для Mini App). Zod `budgetCreate/Update`.
- Web Admin `/budgets`: nav-пункт, `BudgetBar` (первый multi-threshold бар good/warn/over), карточка общего потолка, «+ Бюджет»/«Без лимита», isLoading/isError/empty, toast. Mini App: read-only бейдж остатка «осталось X €» на плитке категории при вводе (правило 11 уточнено → «ввод + read-only подсказки»).
- Phase 3: qa=PASS_WITH_NICES, arch=APPROVED_WITH_NICES, 0 must-fix. Визуально: test_admin_ui (`/budgets` light/dark/modal) + test_miniapp_react (бейдж good/warn/over) проверены скриншотами. 9 vitest на `computeBudgetProgress` (границы месяца, date-aware, missing-rate, пороги, total, пустой месяц).

---

## 🔄 В работе

**✅ Стадия 2 завершена — MVP финализирован (2026-05-29).** Все батчи punch-list'а A–F + SPEC-019 закрыты (ветка `refactor/mvp-stage2`, см. `docs/review-mvp-stage1.md` § Прогресс). Финальный gate: `mvp_ready=yes`, 0 блокеров, все must-fix исходного ревью подтверждены закрытыми; 42 vitest + typecheck (worker/admin/miniapp) зелёные. Осталось организационно: merge `refactor/mvp-stage2` → `main` + деплой (worker + оба Pages) после локального UI-теста. Дальше — **post-MVP**.

Все базовые потоки (Stage 8 + 8.5 Dashboard v2, SPEC-016 canonical conversion, SPEC-017 категории, SPEC-018 линза) закрыты. Post-MVP на выбор: Stage 5b (графики снапшотов), Stage 9 (инвестиции), Stage 10 (AI Coach), виртуализация длинных списков, отдельный график на целевые фонды (NG2 SPEC-018).

### Post-MVP хвосты (из ревью Стадии 1, 2026-05-28)
- **Аналитика расходов в Mini App (Phase 2 SPEC-014).** При React-rewrite vanilla-аналитика (stats/donut/trend/drilldown) не воссоздана. Решение: scope Mini App сужен до «только ввод», аналитика — в Web Admin (CLAUDE.md правило 11 обновлено). Быстрая аналитика на телефоне — **план post-MVP**, не блокер MVP.
- **Мобильный ввод дохода/снапшота/обмена.** Сейчас только Web Admin (десктоп). Post-MVP: лёгкая text-команда в боте (bot.ts уже парсит expense). Зафиксировано как осознанный non-goal (architecture.md).

### Открытые хвосты (зафиксировано в конце сессии 2026-05-26)
- **Зарплата RSD за 2024 – середину 2025 не внесена.** EUR-нал историю добавили: 18 записей `2024-01-15…2025-06-15` (общая месячная сумма на `eur-cash` (суммы скрыты)), стыкуется с существующей записью `2025-07-15`. RSD-часть (1-го числа) за тот же период — **ждёт суммы от Stepan'а**, если нужна. Backup перед вставкой: `local/backups/d1-pre-salary-20260526-213929.sql`.
- **account_id зарплаты = `eur-cash` (осознанный компромисс).** Записана вся месячная зарплата (нал + банк вместе) на «EUR · нал»: для дохода-аналитики корректно, но баланс по счетам в прошлом искажён (нал завышен, банк занижен). Можно перевесить — id записей `legacy-salary-eur-*` детерминированы, правится одним UPDATE.
- **SPEC-015 OQ — семантика «свободного дохода».** Заложено: свободный доход = доход без goal-помеченного (`incomes.goal_id`); линза влияет на Net worth / Runway / Доход / Норму, траты — нет. Пересмотреть при реальном использовании. `free net worth` в спарклайне и `prev_free_net_worth` (для Δ) — аппроксимация (total − текущее `targeted`; историч. goal balance не реконструируем).
- [x] **Редактирование категорий** — ✅ закрыто SPEC-017 (CRUD в Web Admin `/categories`, расход + доход, мягкая деактивация).
- **Флаг валюты в выборе счёта** — сделано в Admin (этой сессией: `<AccountOption>` в снапшотах/доходах/обменах/целях) и ранее в Mini App. Закрыто.

---

## 📋 Дальше

### Виртуализация длинных списков (perf/UX)

**Проблема**: списки грузятся целиком и рендерятся в DOM полностью — Mini App `useExpenses` (`limit=5000`), Admin `/expenses`/`/incomes`/`/transactions`/`/snapshots` + contributions (`limit=20000`). Данные растут (>1800 трат и далее) → тяжелеет и сетевая загрузка, и рендер тысяч узлов. Текущий «lazy-рендер на клиенте» в Mini App — это отложенный рендер, **не** настоящая виртуализация.

**Цель**: не грузить всё сразу, но при скролле вниз — без ощущения задержки.

**Предлагаемый подход (передовой, без новых зависимостей вне TanStack-стека)**:
- **Рендер** — windowing через `@tanstack/react-virtual`: в DOM только видимые строки + overscan-буфер; динамическая высота (`measureElement`).
- **Загрузка** — серверная **keyset-пагинация** (cursor по `date DESC, created_at DESC`, не OFFSET — дешевле на D1) + `useInfiniteQuery` (TanStack Query), порции по ~50–100.
- **«Без задержек»** — `overscan` в virtualizer + **prefetch следующей страницы** при приближении к концу окна (триггер за N строк до конца): данные приходят раньше, чем доскроллишь.

**Затрагивает**: Worker (cursor-параметры в `listExpenses`/`listIncomes`/`listTransactions`/`listSnapshots`), Admin таблицы (как windowing дружит с TanStack Table — sticky header, серверные фильтры/сортировка), Mini App `HistoryScreen`.

**Когда возьмём** — `SPEC-NNN` (Phase 1): единый паттерн `useInfiniteList`-hook, формат cursor, серверные фильтры vs клиентские.

### Stage 5b — Графики снапшотов (после Stage 8)
- Balance over time per bucket (step chart).
- Net worth over time (stacked area по форме / валюте).
- [x] Sparklines на карточках в `/accounts` — ✅ закрыто SPEC-021 (нативный ряд `by_bucket_native` из dashboard-агрегатора, искра в цвете ведра + net worth).

### Stage 5d — Legacy import (отложено)
- Импорт 33 EUR-eq снимков из `data/legacy/Finances.xlsx` с обратной конверсией по историческим курсам. Решено начать с нуля; восстановление — only if нужно.

### Stage 9 — Инвестиции ✅ (крипто-портфель, SPEC-026/027/028 — на проде)
- ✅ Крипто-портфель: ETH-холдинг как ведро (`is_investment`), курс ETH/EUR, раздел `/investments` (стоимость, cost basis WAC, P&L, доход стейкинга), `free = net − targeted − invested`.
- ✅ Стейкинг (stETH/Lido/Bybit): признак позиции + доход из снапшотов (ground truth) + APR-прогноз пунктиром; частичный стейкинг + авто-APR с Lido (SPEC-027).
- ✅ Устойчивость курса ETH (SPEC-028): цепочка провайдеров Binance→Coinbase→CoinGecko (fallback при гео-блоке CF-IP), cron 4×/сутки, внутридневные тики (`rate_ticks`) + tick-aware mark-to-market «по времени фетча».
- Отложено (NG SPEC-026): realized P&L при продаже, акции/ETF/банк-%, отдельная котировка stETH (пег), авто-interest-tx (конфликт с manual=ground-truth).

### Stage 10 — AI Coach
LLM-агент с доступом к финансовым данным; шлёт инсайты в Mini App / Web Admin / Telegram-бота.

**Каналы**: `/coach` в Admin с историей + чат, push-карточка в Mini App, proactive `sendMessage` через bot.

**Типы коммуникации**:
- Weekly digest (понедельник).
- Anomaly alert (большая разовая трата, нетипичная категория, рост > порога).
- Missing-expenses reminder (детект по гэпу).
- Goal check-in.
- Onboarding survey + re-check раз в 3 месяца.
- Free-form chat в Admin.

**Архитектура**: Claude API (Sonnet 4.6 для рутины, Opus 4.7 для глубокого) либо Cloudflare Workers AI Llama 3.2 на бесплатном tier. Новые D1: `coach_messages`, `coach_profile`, `coach_surveys`. Worker cron расширяется. Tool use: типобезопасные обёртки `query_expenses`, `query_snapshots`, `compute_metric`.

**Бюджет**: Claude personal scale ≈ $5–15/мес; Workers AI free tier 10k/день покрывает почти всё.

Требует Stage 8 (Dashboard) для готового аналитического слоя.

---

## 🗑 Откатанные фичи (cancelled)

Решения которые попробовали — потом откатили после реального использования.

### SPEC-008 chains (multi-step exchange builder) + SPEC-009 goal-tagged tx → SPEC-012
- Pyramid `chain_id`/`chain_sequence` + UI builder + `/chains/:id` detail удалены.
- Goal_id на transactions + spread loss в goal balance удалены.
- Причина: на реальных данных это шум без actionable insight. «Получил 100k, обменял частями в разные даты — всё мешается». Категории `incomes.goal_id` остаются как единственный путь привязать деньги к цели.
- Колонки `transactions.chain_id/chain_sequence/goal_id` сохранены в схеме как «спящие» (без миграций удаления), на случай возврата фичи.

### Receipt scanner (отвергнуто 2026-05-25)
- Идея фото чека → AI extracts items → автозапись expense с детализированными items.
- Бесплатное решение существует (сербский `suf.purs.gov.rs` через QR + Workers AI fallback).
- Пользователь решил не делать — приоритет другим этапам.

---

## 🧹 Технический долг

### SPEC-008/010/012 (transactions / chains откат)
- [ ] Удалить «спящие» колонки `transactions.chain_id/chain_sequence/goal_id` миграцией, если через 3 месяца фича не вернётся.
- [x] `data-model.md` — ✅ обновлён под текущую схему (Стадия 2 Batch A). Заодно: `stack.md`, `architecture.md §Отказоустойчивость`, ADR-001/004/008 superseded-маркеры, новый ADR-015 (REAL-деньги), email→placeholder в SPEC-004.

### Из retro audits SPEC-001..005 (по модулям)

**Worker / Backend:**
- [ ] Серверная валидация payload'ов в `POST/PUT /v1/expenses` и `/v1/web/snapshots` — сейчас минимум, missing required → 500 с leak'ом стек-трейса. Внедрить тонкий zod-слой / ручной guard → 400 с осмысленным сообщением. Stage 6 incomes уже имеет образец.
- [ ] **SPEC-006 N6**: deactivation logic непоследовательна между доменами — `accounts.deleted_at IS NULL` vs `categories.is_active = 1`. Унифицировать.
- [ ] **SPEC-006 OQ1**: PUT /v1/web/incomes/:id с новым `account_id` другой валюты — currency_code пересчитывается, amount остаётся. Потенциальное «100000 RUB вдруг стало 100000 EUR». Добавить guard.
- [ ] `500 → String(err)` утечка — `index.ts:113`. Заменить на generic message + structured log.
- [ ] `auth_date` freshness не проверяется в initData. OK для single-user.
- [ ] `bot.ts` `parseExpense` принимает любой 3-5 буквенный токен как currency без проверки.
- [ ] Telegram webhook без `secret_token` header.
- [ ] `listExpenses` не фильтрует по `user_id`. OK для single-user.
- [ ] `limit` парсится без валидации — `?limit=abc` → `LIMIT NaN`.
- [ ] `/healthz` принимает любой HTTP method.
- [ ] `/v1/admin/bulk-rates` без cap на размер массива и per-item validation.
- [x] **Currency conversion: date-aware rate** — ✅ закрыто SPEC-016 (canonical `RatesIndex`, модель запас/поток, ADR-014).

**Mini App:**
- [ ] Donut tap unreliable в Playwright — null fill центра. Сделать arc `<path fill="..."/>` или transparent overlay.
- [ ] A11y: `aria-label` на `.back-btn`, `#open-date`, `#open-note`, `data-key`, `.iconbtn`. Toast → `role="status"`.
- [ ] CSP отсутствует.
- [ ] `escapeHtml` не экранирует `'`.
- [ ] Магические числа в `app.js` (swipe threshold, timeouts, max amount) — в const.
- [ ] Эмодзи полей не экранируются — D1-admin-injection vector если SYNC_TOKEN утечёт.
- [ ] `confirm()` → `tg.showConfirm()` для нативного iOS look.
- [ ] Low contrast: today trend bar / "Прочее" donut.

**Web Admin:**
- [ ] **SPEC-006 N5**: `pluralize(n)` локальный helper — вытащить в `lib/i18n.ts` если появятся другие.
- [ ] **SPEC-006 N3**: TypeScript contract drift между worker и admin типами. Shared schema через `zod` / OpenAPI gen.
- [ ] Plain-text 4xx OAuth-ошибки (`forbidden`, `bad state`). UX-error page.
- [ ] Нет toast / ErrorBoundary.
- [ ] Sidebar `disabled` пункты — `<div>` вместо `aria-disabled` button.
- [ ] `BucketCard` hover-only иконка ArrowUpRight без visible affordance для keyboard.
- [ ] `jwt.ts` constant-time HMAC compare + явная валидация `alg`/`typ` header.
- [ ] **SPEC-007 audit deferred**: Edit Contribution UI (нет Pencil на manual contribution в /goals/:id), isError state на pages (нет баннера при 5xx), goal без `target_currency` legacy fallback.

**Test tooling:**
- [ ] `test_ui.py` — `socketserver.TCPServer.allow_reuse_address = True` (port leak при re-run).
- [ ] `test_ui.py` mock-clock pinning + selector by data-attribute.
- [ ] `test_ui.py` mock Telegram WebApp `version: "7.10"`.

**Из SPEC-013 (Stage 8 dashboard) audit:**
- [x] AC2 edge: `/accounts` глобальный `MAX(date)` → 0 при stale-quote — ✅ закрыто SPEC-016 (per-quote `rateAt(today)` на worker, `effective_balance_eur`).
- [ ] `net_worth_series` missing-rate невидим: точка молча занижается, не растит `missing_rates` (низкая вероятность — rates backfill с 2024).
- [ ] `listGoals` внутри dashboard повторно грузит incomes/rates — инлайнить goal-агрегацию в общий батч (−3 D1-запроса).
- [ ] ECharts ~350KB gzip на landing `/` — `React.lazy(DashboardPage)` срежет initial TTI.
- [ ] Date helpers: worker UTC vs клиент local — на границе суток окно может прыгнуть на день (single-user, редко).
- [ ] FORM_LABEL/FORM_COLOR содержат dead-ключ `crypto` (USDT-ведро = `form='digital'`) — выровнять form-таксономию.

**Из SPEC-016 (canonical conversion) audit:**
- [ ] Двойной `loadRatesIndex` на `/v1/web/accounts` (handler + внутри `listGoals`) — передать готовый индекс параметром или общий aggregator с dashboard. Single-user — не критично.
- [x] Residual клиентский `toEur` в `IncomesPage` / `DashboardPage` — ✅ закрыто SPEC-017 (canonical-инвариант глобальный: worker-поля `amount_eur` / `balance_eur` / `target_amount_eur`).
- [ ] `/v1/web/references` (`getBootstrapData`) гоняет `listExpenses` (20000 трат + `amount_eur`-цикл + `loadRatesIndex`), затем выбрасывает `expenses` — флаг `withExpenses` или отдельный refs-путь.
- [ ] `AccountsPage` дёргает `useGoals` только ради `goalCount` (split уже в `summary`) — отдать `goal_count` в `summary`.
- [ ] Округление `amount_eur` до 2 знаков per-row до суммирования на клиенте (DayTotal / Expenses total) vs неокруглённое суммирование в dashboard — микро-расхождение в центах. Косметика.
- [ ] `free_eur < 0` в AccountsPage SummaryCard без визуального акцента (в bucket-карточках акцент есть).
- [ ] Бейдж «N без курса» (AccountsPage, amber-600 на `text-xs`) контраст ~3.4:1 < 4.5 — пограничный a11y (пре-существующий паттерн drift/baseline-хинтов).

**Из SPEC-020 (budgets) audit:**
- [ ] Двойной `loadRatesIndex` на полном bootstrap-пути Mini App (`listExpenses` + `getBudgetsWithProgress`) — частичный откат Фазы 1.8 (dedup). Прокинуть готовый `RatesIndex` в `getBudgetsWithProgress` ИЛИ общий aggregator (R4). Single-user — не критично.
- [ ] `pct` (display = `Math.round(spent/limit*100)`) может расходиться со `status` (от сырых сумм) на rounding-границах (напр. 99.9% показывает «100%» при статусе warn). Косметика; `status` авторитетен. Опц.: floor для display или label из status.
- [ ] `limit_eur` без верхней границы (Zod `positive` без `.max`) — fat-finger `300000` пройдёт. Добавить разумный cap.
- [ ] `createBudget` `INSERT OR IGNORE` маскирует гонку unique-индекса как `200 {inserted:false}` (для single-user недостижимо). Опц.: 409 на не-идемпотентном id.
- [ ] Mini App бейдж: `remaining_eur == 0` ровно → «≈0 €» амбером (status=warn). Граничный, приемлемо.

**Из SPEC-021 (sparklines /accounts) audit:**
- [x] Presence-смоук на `by_bucket_native` в `getDashboard` — ✅ закрыто SPEC-022 (D1-мок `getDashboard` + гард equality с `getEffectiveBalance(today)`, `test/dashboard.test.ts`).
- [ ] Двойной `loadRatesIndex` на `/accounts` теперь и через `useDashboard` (ещё один dashboard-агрегатор поверх `useAccounts`) — то же, что тех-долг **2.7** (общий aggregator dashboard↔accounts). Single-user — не критично.
- [ ] AC1 для крипты: `by_bucket_native` округлён `r2` (2 знака), `effective_balance` — `roundMoney` (8 знаков) → для USDT дробные суб-центы расходятся в отображаемой точности. Осознанно (§6/R3, искра 28px), не дефект.

**Process:**
- [ ] **SPEC-006 audit redo**: 2026-05-25 senior-qa + solution-architect agents пять раз падали с 529 Overloaded → self-audit fallback. Пересмотреть независимыми агентами когда API стабилен.

### Прочее

- [ ] **#20**: переименовать корень с `excel/` → `finance/` (или `ledger/`).
- [ ] Удалить мёртвый код в `tools/excel/` если Legacy полностью мигрирован.
- [ ] `init_db.py` + `migrate_to_d1.py` — переместить в `legacy/scripts/` или удалить.
- [ ] Опционально: переезд Worker в Pages Functions для same-origin (упрощает auth, убирает CORS).

---

## Текущий этап

**MVP финализирован (2026-05-29).** Стадия 1 (стратегическое ревью) + Стадия 2 (рефакторинг A–F + SPEC-019) завершены. Math строгая (manual = ground truth, events = delta), доки синхронизированы с кодом, финмодель/метрики корректны, серверная валидация (Zod) на месте, мёртвый код вычищен. Деплой Стадии 2 — после merge в `main` + локального UI-теста фронтов.

**Post-MVP (на выбор):**
- Хвост Batch E: shared-контракт worker↔admin (Zod-схемы в общий пакет) + `withAdminSession`-обёртки + rates-aggregator против двойного `loadRatesIndex`.
- Stage 5b (графики снапшотов), Stage 9 (инвестиции), Stage 10 (AI Coach), виртуализация длинных списков.
- Мобильный ввод дохода/снапшота (text-команда бота). Внесение RSD-зарплаты 2024–сер.2025.
- Миграция удаления спящих tx-колонок `chain_id/chain_sequence/goal_id` (~08-2026). Переименование корня `excel/` (#20). FK-проверка `snapshot.account_id`.
