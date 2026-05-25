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

---

## 🔄 В работе

Между этапами. Следующий — Stage 8 (Dashboard).

---

## 📋 Дальше

### Stage 5b — Графики снапшотов (после Stage 8)
- Balance over time per bucket (step chart).
- Net worth over time (stacked area по форме / валюте).
- Sparklines на карточках в `/accounts`.

### Stage 5d — Legacy import (отложено)
- Импорт 33 EUR-eq снимков из `data/legacy/Finances.xlsx` с обратной конверсией по историческим курсам. Решено начать с нуля; восстановление — only if нужно.

### Stage 8 — Главный дашборд (Web Admin)
- KPI карточки: net worth, monthly burn, runway, monthly income, savings rate.
- Time series: balance over time, expenses by category, income vs expenses.
- Multi-currency consolidation в base currency.
- Фильтры по периоду / типу счёта / категории.
- Открывает date-aware rate lookup (см. tech-debt) для historical accuracy.

### Stage 9 — Инвестиции
- `yield_pct` на Account: автоматическая транзакция `interest` ежемесячно.
- Ожидаемый доход за период, реальный yield.
- (когда появятся) Holdings: акции / ETF, цены, P&L.

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
- [ ] `data-model.md` — обновить полностью под текущую схему (snapshots без auto, transactions без chains, goals).

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
- [ ] **Currency conversion: date-aware rate** — `loadRatesForDate(date)` вместо `loadRates()` для historical accuracy в goal balance / KPI. Дешёвая правка, нужна для Stage 8.

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

**Process:**
- [ ] **SPEC-006 audit redo**: 2026-05-25 senior-qa + solution-architect agents пять раз падали с 529 Overloaded → self-audit fallback. Пересмотреть независимыми агентами когда API стабилен.

### Прочее

- [ ] **#20**: переименовать корень с `excel/` → `finance/` (или `ledger/`).
- [ ] Удалить мёртвый код в `tools/excel/` если Legacy полностью мигрирован.
- [ ] `init_db.py` + `migrate_to_d1.py` — переместить в `legacy/scripts/` или удалить.
- [ ] Опционально: переезд Worker в Pages Functions для same-origin (упрощает auth, убирает CORS).

---

## Текущий этап

**Между этапами.** Все базовые потоки (расходы, доходы, снапшоты, цели, обмены, math consistency) закрыты. Math работает строго: manual = ground truth, events = delta, никаких auto-snapshots.

**Следующий приоритет** — Stage 8 (Dashboard). Альтернативы: разгрести tech-debt секцию (особенно `data-model.md` update + date-aware rates) если хочется навести порядок в фундаменте перед новой большой фичей.
