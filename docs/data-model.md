# Модель данных

> Актуально на post-MVP (после ADR-011/012/014…021). **Единственная база — Cloudflare D1** (ADR-011); локального SQLite-источника правды больше нет. Канонический снапшот схемы — `cloud/worker/schema.sql`; история — `cloud/worker/migrations/0001…0017`.
>
> `local/finances.db` и `local/migrations/` — наследие до-D1-эпохи (см. `local/legacy/`), **не источник правды**.

## Принципы

- **UUID v4** на клиенте для транзакционных сущностей (expenses, incomes, snapshots, transactions, goals, goal_contributions). `INSERT OR IGNORE` по PK → идемпотентность (ADR-005).
- **Справочники** (accounts, categories, income_categories, currencies) — semantic ID в kebab-case.
- **Все timestamps** — TEXT. Даты операций (`date`) — `YYYY-MM-DD`, в **локальной зоне пользователя** (SPEC-024); экономическая дата, может быть backdated. `created_at`/`updated_at` — каноничный `YYYY-MM-DD HH:MM:SS` (UTC, `datetime('now')`); `created_at` = **время записи** и tie-break порядка событий внутри одного дня (см. `effective_balance`). Расходы тоже получают серверный `created_at` (не часы клиента).
- **Денежные суммы** — `REAL` (ADR-015): single-user, малые суммы, округление на выдаче. Не integer-cents.
- **Soft-delete** — `deleted_at TEXT` везде; все агрегаты фильтруют `deleted_at IS NULL`.
- **Балансы не хранятся** — вычисляются on-read (`effective_balance`, см. ниже).

## Таблицы D1

### Справочники

**`accounts`** — счета как «вёдра» по паре (валюта × форма).
| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | semantic, напр. `eur-cash`, `rsd-bank`, `usdt` |
| `name` | TEXT | отображаемое имя |
| `type` | TEXT | `bank` \| `cash` \| `crypto` \| `external` |
| `currency` | TEXT | код валюты |
| `form` | TEXT | `cash` \| `digital` \| `external` (таксономия вёдер) |
| `is_active` | INTEGER | 1/0 |
| `color`, `sort_order`, `deleted_at`, `updated_at` | | UI + soft-delete |

Вёдра для балансов = `WHERE form != 'external' AND deleted_at IS NULL`. `external` — псевдо-счёт «внешний мир».

**`categories`** — категории расходов (`type = 'expense'`); деактивация через `is_active = 0` (история сохраняет подпись, SPEC-017). Поля: `id, name, type, parent_id, emoji, color, sort_order, is_active, updated_at`.

**`income_categories`** — категории доходов. Поля: `id, name, emoji, color, sort_order, is_active, created_at`.

**`currencies`** — `code` PK, `name`, `emoji`, `is_crypto`, `decimals`.

**`authorized_users`** — whitelist Telegram (ADR-009): `telegram_id` PK, `name`, `created_at`. По умолчанию — только владелец.

### Транзакционные

**`expenses`** — ежедневные траты (Mini App + бот).
| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | UUID от Mini App |
| `user_id` | TEXT | Telegram user ID (поле прямо в таблице, без отдельного outbox) |
| `date` | TEXT | `YYYY-MM-DD` |
| `account_id` | TEXT FK→accounts | nullable (импорт без счёта) |
| `amount` | REAL | положительная сумма расхода |
| `currency` | TEXT | |
| `category_id` | TEXT FK→categories | |
| `note`, `source`, `source_record_id` | | `source`: `mini_app` \| `telegram_bot` \| `csv_ok_import` \| `migration` |
| `created_at`, `updated_at`, `deleted_at` | | |

**Инвариант валюта↔счёт (SPEC-032):** для траты со счётом `expenses.currency == accounts.currency` (ведро денoминировано в одной валюте; `effective_balance` вычитает расход в native-валюте ведра — рассогласование тихо искажает баланс). Энфорсится в `createExpense`/`updateExpense` (`db.ts:currencyMismatchError`): account-bound `currency != account.currency` без флага `allow_currency_mismatch` → 400. Трата «без счёта» (`account_id IS NULL` — бот, CSV-импорт, ручной выбор «Без счёта») валюту имеет свободную (используется только для EUR-конверсии/репортинга). Mini App предотвращает рассогласование auto-bind'ом (выбор счёта ставит его валюту) + осознанным override.

**`incomes`** — доходы (Web Admin). `id, date, account_id, amount(>0), currency_code, category_id, source, note, goal_id?(FK→goals), created_at, updated_at, deleted_at`. `goal_id` — привязка дохода к цели (единственный способ «отложить в цель» после SPEC-012).

**`transactions`** — обмены/переводы (Web Admin). `type CHECK IN ('exchange','transfer')`, `from_account_id`, `to_account_id`, `from_amount(>0)`, `from_currency`, `to_amount(>0)`, `to_currency`, `fee_amount?(>=0)`, `fee_currency?`, `note`, `created_at`, `updated_at`, `deleted_at`.
- `exchange`: разные валюты; `transfer`: одна валюта, `from_amount == to_amount`.
- **Спящие** колонки `chain_id`, `chain_sequence`, `goal_id` — наследие откатанной фичи (SPEC-012), всегда NULL для новых записей; миграция на удаление — после ~08-2026.
- `fee_amount`/`fee_currency`: с Стадии 2 fee **вычитается** из ведра, чья валюта = `fee_currency` (приоритет `from_account`); см. `ledger.feePayerBucket` + `getEffectiveBalance`. Ограничение: комиссия в третьей валюте (≠ from/to) не атрибутируется ни одному ведру (редко); при soft-deleted ведре-контрагенте fee-разбивка может разойтись между `/accounts` и `/dashboard` (low, single-user — не воспроизводится).

**`snapshots`** — ручные снимки баланса ведра. `id, date, account_id, amount, note, source('manual'|'auto_transaction'), transaction_id?, created_at, updated_at, deleted_at`.
- После SPEC-011 (миграция 0010) auto-снапшоты не создаются; для баланса используются **только** `source = 'manual'`.

**`rates`** — дневные курсы (ADR-006). PK `(date, base, quote)`, `rate` (`1 base = rate × quote`), `base` фиксированно `EUR`, `source`, `fetched_at`. Источник historical-конверсии (поток по дате).

**`rate_ticks`** — внутридневные тики курса (SPEC-028/ADR-019). PK `(base, quote, fetched_at)`, те же `rate`/`source`. Крипта пишет тик при каждом фетче; mark-to-market «сейчас» берёт `MAX(fetched_at)` (свежесть по времени фетча, а не по календарной дате). Фиат тики не пишет.

**`goals`** — целевые фонды. `id, name, emoji, color, target_amount?(>0), target_currency?(FK), deadline?, note, status('active'|'achieved'|'archived'), sort_order, created_at, updated_at, deleted_at`.

**`goal_contributions`** — ручные взносы в цель. `id, goal_id(FK), date, amount(>0), currency_code, account_id?(FK), note, created_at, updated_at, deleted_at`.
- **Инвариант (Стадия 2):** `account_id` обязателен — каждый взнос привязан к реальному ведру, чтобы `targeted` сходился с `net` (см. ниже).

## Ключевые инварианты

### `effective_balance` ведра (SPEC-011)

Баланс ведра вычисляется on-read, не хранится:

```
effective_balance(bucket, asOf) = last_manual_snapshot.amount   (date ≤ asOf)
   + Σ events  где  event.date ≤ asOf  И
        ( event.date > snapshot.date
          ИЛИ (event.date == snapshot.date И event.created_at > snapshot.created_at) )
```

- **baseline** — последний `source='manual'` snapshot ведра с `date ≤ asOf` (ничья по дате → max `created_at`). Нет baseline → 0 + все события.
- **events** в native-валюте ведра: incomes (+), expenses (−), transactions (−from_amount / +to_amount), goal_contributions (+amount при `account_id = bucket`), fee (−fee_amount у ведра-плательщика).
- **Порядок внутри дня по `created_at`** (SPEC-024): дата операции — главный ключ (backdating сохраняется), а при равной дате tie-break решает **время записи** — «событие, записанное после снапшота того же дня, учитывается; записанное до — уже в снапшоте». Это требует каноничного формата `created_at` (миграция 0013) и серверного `created_at` расходов. Остаточный край: backdated-событие на дату снапшота, введённое после него — редко, самоисправляется следующим снапшотом.
- Реализация: `cloud/worker/src/snapshots.ts:getEffectiveBalance` (per-bucket, авторитетная) и `dashboard.ts:balanceAt` (in-memory батч для серий) — обе зеркалят `ledger.ts:reconstructBalance`.
- native-баланс округляется до 8 знаков на выдаче (ADR-015).

### Конвертация в EUR (ADR-014, SPEC-016)

Единственный слой — `RatesIndex` (`cloud/worker/src/rates.ts`). Клиенты не делят на курс, получают готовые `*_eur` поля. Модель двух классов:
- **Запас** (баланс в моменте: вёдра, net worth, накопленное в `target_currency` → EUR) → курс **на сегодня** (`rateAt(today)`, mark-to-market).
- **Поток** (операция на дату: расход, доход, day-total; **вклад в цель**; точка net-worth-series на конец месяца) → курс **на дату операции** (`rateAt(date)`, date-aware).
- `rateAt` берёт ближайший курс с `date ≤ target` (нет точного — fallback назад, не 0).

**Вклад в цель — поток (ADR-020/SPEC-025).** Конверсия вклада (`incomes.goal_id`, `goal_contributions`) в `target_currency` фиксируется по курсу **на дату вклада** и дальше не меняется (раньше был mark-to-market по сегодняшнему курсу — псевдо-запас, ломался на обменах RUB→USDT→EUR). Шаг «накопленное в `target_currency` → EUR» (`balance_eur`, `targeted_eur`) остаётся запасом (today). Так прогресс цели в целевой валюте стабилен и не зависит от обменов (цель структурно не читает `transactions`).

### Net worth / Свободно / Целевые / Инвестиции (SPEC-013/015/026)

```
net_worth   = Σ effective_balance(bucket) → EUR (today)
targeted    = Σ goal.balance → EUR (today)       # goal.balance — поток в target_currency (фикс по дате вклада, ADR-020); → EUR по today
invested    = Σ effective_balance(bucket WHERE is_investment=1) → EUR (today)   # SPEC-026
free        = net_worth − targeted − invested    # без клампа: может быть < 0 (цели недообеспечены) — danger-сигнал в Admin
```

**Инвариант (ADR-020/SPEC-025):** `targeted` зафиксирован в целевой валюте по датам вкладов, `net` следует за валютой, где деньги реально лежат (`effective_balance` учитывает обмены). Совпали валюты вклада и текущего нахождения — курс к EUR двигает `net` и `targeted` одинаково, `free` стабилен; разошлись (был обмен) — расхождение и есть сигнал обеспеченности. `free` **может быть отрицательным** (net < targeted) — это сигнал «доложить / пересмотреть цели», нигде не клампится на worker. Каждый targeted-евро физически лежит в ведре (через `income.goal_id` или `goal_contribution.account_id`); `income.goal_id` и взнос `goal_contribution` на одни и те же деньги — взаимоисключающие. **SPEC-026:** инвест-ведро (`accounts.is_investment=1`) входит в `net_worth` (реальный актив), но вычитается из free как `invested`; `invested ⊆ net` (нет двойного счёта). Инвест-ведро **нельзя** использовать как backing цели (`goal_contribution.account_id`) — иначе `targeted` и `invested` пересеклись бы. Рост курса крипто-актива поднимает `net` и `invested` на одну сумму → `free` не меняется (нереализованная прибыль ≠ свободные деньги). На дашборде `prev_free` вычитает `prev_invested` (корректный Δ).

### Инвестиции (SPEC-026)

- **`accounts.is_investment`** (INTEGER, default 0): флаг ведра-актива. Seed: `eth-invest` (currency=ETH). Уникальный partial-индекс — не более одного активного инвест-ведра на валюту.
- **`investment_settings`** (`account_id` PK, `staked_qty`, `staking_apr_pct`, `note`, `is_staked` legacy): настройки стейкинга. `staked_qty` (SPEC-027) — сколько единиц актива в стейкинге (частичный стейкинг; `0` = убрать; остальное = свободно); `is_staked` теперь **производный** (`staked_qty>0`). `staking_apr_pct` — ручной **override** APR (NULL = авто-APR с Lido). Состояние портфеля (qty/cost basis/P&L/доход) **не хранится** — линза on-read (`investments.ts`).
- **`app_config`** (`key` PK, `value`, SPEC-027): глобальный key/value. `steth_apr_pct` — авто-APR stETH с публичного Lido API (cron + `/v1/admin/refresh-rates`). Эффективный APR позиции = override `??` авто.
- **Валюта ETH** в `currencies` (is_crypto=1, decimals=6). Курс ETH/EUR — цепочка провайдеров **Binance→Coinbase→CoinGecko** (SPEC-028/ADR-019, fallback при гео-блоке CF-IP), cron 4×/сутки + бэкфилл `backfill_crypto_rates.py`; хранится как `1 EUR = rate × quote` → `rate = 1/price`. Пишется в дневной `rates` (закрытие дня) **и** `rate_ticks` (внутридневная свежесть). stETH пегуется к ETH 1:1 (отдельной котировки нет).
- **Покупка** USDT→ETH = `transactions` (`type='exchange'`); **ребейзинг** = `snapshots` инвест-ведра (ground truth). Cost basis — WAC из exchange-истории; доход стейкинга (факт) = `qty(today) − net_bought_qty`.

## Миграции

D1: `cloud/worker/migrations/0001…0017`, применять через `wrangler d1 execute --file` (NOT `migrations apply` — трекинг рассинхрон, memory `d1-migrations-apply-via-execute-file`). `schema.sql` — текущий снапшот (применять для свежей базы). **Правило:** применённые миграции immutable; изменения — только новой миграцией. `0014` = инвестиции (SPEC-026: валюта ETH, `accounts.is_investment`, seed `eth-invest`, `investment_settings`); `0015` = итерация 2 (SPEC-027: `investment_settings.staked_qty`, таблица `app_config`); `0016` = `rate_ticks` (SPEC-028: внутридневные тики курса); `0017` = fix `created_at` импортированных снапшотов против двойного учёта (SPEC-031).

| Миграция | Что |
|---|---|
| 0001-0002 | `device_heartbeats`, `expenses_cache` (дропнуты позже — наследие до ADR-011) |
| 0003 | `expenses` полная схема |
| 0004 | drop legacy |
| 0005 | `rates` |
| 0006 | вёдра (`accounts.form/sort_order/deleted_at`) + `snapshots` |
| 0007 | `income_categories` + `incomes` |
| 0008 | `goals` + `goal_contributions` + `incomes.goal_id` |
| 0009 | `transactions` |
| 0010 | hard-delete `source='auto_transaction'` snapshots (SPEC-011) |
| 0011 | `budgets` (SPEC-020) |
| 0012 | `budget_settings` + `budget_recommendation_log` (адаптивные бюджеты, SPEC-023) |
| 0013 | нормализация формата `expenses.created_at`/`updated_at` под канон `YYYY-MM-DD HH:MM:SS` (SPEC-024) |
| 0014 | `accounts.is_investment` + `investment_settings` + валюта ETH (SPEC-026) |
| 0015 | `investment_settings.staked_qty` + `app_config` (SPEC-027) |
| 0016 | `rate_ticks` — внутридневные тики курса (SPEC-028) |
| 0017 | fix `created_at` импортированных снапшотов — устранение двойного учёта (SPEC-031) |
