# Модель данных

> Актуально на Стадию 2 (после ADR-011/012/014). **Единственная база — Cloudflare D1** (ADR-011); локального SQLite-источника правды больше нет. Канонический снапшот схемы — `cloud/worker/schema.sql`; история — `cloud/worker/migrations/0001…0010`.
>
> `local/finances.db` и `local/migrations/` — наследие до-D1-эпохи (см. `local/legacy/`), **не источник правды**.

## Принципы

- **UUID v4** на клиенте для транзакционных сущностей (expenses, incomes, snapshots, transactions, goals, goal_contributions). `INSERT OR IGNORE` по PK → идемпотентность (ADR-005).
- **Справочники** (accounts, categories, income_categories, currencies) — semantic ID в kebab-case.
- **Все timestamps** — ISO 8601, TEXT. Даты операций — `YYYY-MM-DD` (date-only); `created_at`/`updated_at` — `datetime('now')`.
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

**`incomes`** — доходы (Web Admin). `id, date, account_id, amount(>0), currency_code, category_id, source, note, goal_id?(FK→goals), created_at, updated_at, deleted_at`. `goal_id` — привязка дохода к цели (единственный способ «отложить в цель» после SPEC-012).

**`transactions`** — обмены/переводы (Web Admin). `type CHECK IN ('exchange','transfer')`, `from_account_id`, `to_account_id`, `from_amount(>0)`, `from_currency`, `to_amount(>0)`, `to_currency`, `fee_amount?(>=0)`, `fee_currency?`, `note`, `created_at`, `updated_at`, `deleted_at`.
- `exchange`: разные валюты; `transfer`: одна валюта, `from_amount == to_amount`.
- **Спящие** колонки `chain_id`, `chain_sequence`, `goal_id` — наследие откатанной фичи (SPEC-012), всегда NULL для новых записей; миграция на удаление — после ~08-2026.
- `fee_amount`/`fee_currency`: с Стадии 2 fee **вычитается** из ведра, чья валюта = `fee_currency` (приоритет `from_account`); см. `ledger.feePayerBucket` + `getEffectiveBalance`. Ограничение: комиссия в третьей валюте (≠ from/to) не атрибутируется ни одному ведру (редко); при soft-deleted ведре-контрагенте fee-разбивка может разойтись между `/accounts` и `/dashboard` (low, single-user — не воспроизводится).

**`snapshots`** — ручные снимки баланса ведра. `id, date, account_id, amount, note, source('manual'|'auto_transaction'), transaction_id?, created_at, updated_at, deleted_at`.
- После SPEC-011 (миграция 0010) auto-снапшоты не создаются; для баланса используются **только** `source = 'manual'`.

**`rates`** — курсы (ADR-006). PK `(date, base, quote)`, `rate` (`1 base = rate × quote`), `base` фиксированно `EUR`, `source`, `fetched_at`.

**`goals`** — целевые фонды. `id, name, emoji, color, target_amount?(>0), target_currency?(FK), deadline?, note, status('active'|'achieved'|'archived'), sort_order, created_at, updated_at, deleted_at`.

**`goal_contributions`** — ручные взносы в цель. `id, goal_id(FK), date, amount(>0), currency_code, account_id?(FK), note, created_at, updated_at, deleted_at`.
- **Инвариант (Стадия 2):** `account_id` обязателен — каждый взнос привязан к реальному ведру, чтобы `targeted` сходился с `net` (см. ниже).

## Ключевые инварианты

### `effective_balance` ведра (SPEC-011)

Баланс ведра вычисляется on-read, не хранится:

```
effective_balance(bucket, asOf) = last_manual_snapshot.amount   (date ≤ asOf)
                                + Σ events  где  event.date > snapshot.date  и  event.date ≤ asOf
```

- **baseline** — последний `source='manual'` snapshot ведра с `date ≤ asOf`. Нет baseline → 0 + все события.
- **events** в native-валюте ведра: incomes (+), expenses (−), transactions (−from_amount / +to_amount), goal_contributions (+amount при `account_id = bucket`), fee (−fee_amount у ведра-плательщика).
- **Семантика snapshot = «конец дня»**: события строго `date > baseline.date` (события того же дня уже учтены в снапшоте). Чтобы скорректировать баланс в день снапшота — ставь дату следующего дня или сделай новый снапшот.
- Реализация: `cloud/worker/src/snapshots.ts:getEffectiveBalance` (per-bucket, авторитетная) и `dashboard.ts:balanceAt` (in-memory батч для серий). Обе зеркалят одну формулу.
- native-баланс округляется до 8 знаков на выдаче (ADR-015).

### Конвертация в EUR (ADR-014, SPEC-016)

Единственный слой — `RatesIndex` (`cloud/worker/src/rates.ts`). Клиенты не делят на курс, получают готовые `*_eur` поля. Модель двух классов:
- **Запас** (баланс в моменте: вёдра, net worth, goal balance) → курс **на сегодня** (`rateAt(today)`, mark-to-market).
- **Поток** (операция на дату: расход, доход, day-total; точка net-worth-series на конец месяца) → курс **на дату операции** (`rateAt(date)`, date-aware).
- `rateAt` берёт ближайший курс с `date ≤ target` (нет точного — fallback назад, не 0).

### Net worth / Свободно / Целевые (SPEC-013/015)

```
net_worth   = Σ effective_balance(bucket) → EUR (today)
targeted    = Σ goal.balance → EUR (today)
free        = net_worth − targeted
```

`free = net − targeted` сходится by-construction: обе величины — запас по сегодняшнему курсу. **Инвариант:** каждый targeted-евро физически лежит в ведре (через `income.goal_id` или `goal_contribution.account_id`). `income.goal_id` и взнос `goal_contribution` на одни и те же деньги — взаимоисключающие.

## Миграции

D1: `cloud/worker/migrations/0001…0010`, через `wrangler d1 migrations`. `schema.sql` — текущий снапшот (применять для свежей базы). **Правило:** применённые миграции immutable; изменения — только новой миграцией.

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
