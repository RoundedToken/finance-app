# Модель данных

Две базы:
- **`local/finances.db`** (SQLite на MacBook) — полная схема, источник правды.
- **Cloudflare D1** — урезанная схема, только то что нужно Mini App и outbox.

Полные DDL — в `local/schema.sql` и `cloud/worker/schema.sql` (актуальные снапшоты), а также в `local/migrations/` (история).

## Доменные сущности

### Owners (владельцы средств)
Дядя/отец/брат как доверенные хранители своих средств; сам пользователь как `self`.

| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | `'self'`, `'dad'`, `'brother'`, ... — kebab-case |
| `name` | TEXT | Человекочитаемое имя |
| `is_self` | INTEGER | `1` для владельца системы (только одна запись) |

### Currencies (валюты)
| Поле | Тип | Описание |
|---|---|---|
| `code` | TEXT PK | ISO-4217 или crypto-symbol: `EUR`, `USD`, `RUB`, `RSD`, `USDT`, `BTC` |
| `name` | TEXT | Полное имя |
| `emoji` | TEXT | `🇪🇺`, `🇷🇸`, `🇷🇺`, `₮` |
| `is_crypto` | INTEGER | 1 если крипта |
| `decimals` | INTEGER | Сколько знаков после запятой при отображении |

### Accounts (счета и места хранения)
| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | `'acc_sber_rub_deposit'` и т.п. — semantic ID |
| `name` | TEXT | Отображаемое имя ("Сбер вклад") |
| `type` | TEXT | См. ниже — типизация счетов |
| `currency` | TEXT FK | `currencies.code` |
| `owner_id` | TEXT FK | `owners.id` |
| `group_name` | TEXT NULL | Группировка для дашборда: `'RU'`, `'RS'`, `'Cash'`, `'Crypto'`, `'Invest'` |
| `yield_pct` | REAL | Процент годовых (для вкладов/earn) |
| `is_active` | INTEGER | `1` — действующий, `0` — закрытый |
| `color` | TEXT NULL | Hex для условного форматирования |
| `notes` | TEXT NULL | Свободные заметки |
| `created_at` | TEXT | ISO 8601 |

**Типы счетов** (`accounts.type`):
- `cash` — наличные
- `bank_current` — текущий счёт банка
- `bank_deposit` — вклад с процентами
- `exchange` — биржевой spot
- `exchange_earn` — earn-продукт биржи
- `crypto_wallet` — внешний крипто-кошелёк
- `brokerage` — брокерский счёт (на потом)
- `external` — псевдо-счёт «внешний мир» (для income/expense)

### Categories (категории трат/доходов)
Из «Расходы ОК» мигрируется именно эта таблица.

| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | semantic ID |
| `name` | TEXT | "Продукты", "Кафе", "Транспорт" |
| `type` | TEXT | `'expense'`, `'income'`, `'system'` (для technical-категорий) |
| `parent_id` | TEXT NULL FK | для иерархии (Еда > Кафе) |
| `emoji` | TEXT | для UI Mini App |
| `color` | TEXT | hex |
| `sort_order` | INTEGER | для UI Mini App |

### Transactions (значимые события: обмены/переводы/проценты/income)
Это **не** журнал ежедневных трат — для них отдельная `expenses` таблица.

| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | UUID |
| `date` | TEXT | дата события (ISO) |
| `type` | TEXT | См. ниже |
| `from_account` | TEXT NULL FK | откуда |
| `to_account` | TEXT NULL FK | куда |
| `amount_out` | REAL NULL | сумма списания |
| `ccy_out` | TEXT NULL FK | валюта списания |
| `amount_in` | REAL NULL | сумма зачисления |
| `ccy_in` | TEXT NULL FK | валюта зачисления |
| `rate` | REAL NULL | фактический курс операции |
| `fee` | REAL NULL | комиссия |
| `fee_ccy` | TEXT NULL FK | валюта комиссии |
| `chain_id` | TEXT NULL | UUID цепочки (для группировки) |
| `category_id` | TEXT NULL FK | для income (зарплата, дивиденды) |
| `note` | TEXT NULL |  |
| `source` | TEXT | `'manual'`, `'telegram'`, `'csv_import'`, `'estimated'` |
| `created_at` | TEXT |  |

**Типы транзакций** (`transactions.type`):
- `exchange` — обмен валют (amount_out + ccy_out, amount_in + ccy_in разные)
- `transfer` — перевод между своими счетами в одной валюте
- `interest` — начисление процентов (from_account = NULL или `external`)
- `income` — крупный приход (зарплата, продажа, подарок)
- `adjustment` — ручная коррекция при расхождении со снапшотом

### Expenses (ежедневные траты — поступают с телефона)
Отдельная таблица потому, что:
- Объём гораздо больше, чем transactions.
- Поступают через выделенный канал (Telegram Mini App).
- Имеют upstream UUID для идемпотентности sync.

| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | UUID, сгенерирован в Mini App |
| `date` | TEXT | дата траты (ISO, может отличаться от created_at) |
| `account_id` | TEXT FK | с какого счёта |
| `amount` | REAL | сумма (положительная, расход) |
| `currency` | TEXT FK |  |
| `category_id` | TEXT FK |  |
| `note` | TEXT NULL |  |
| `source` | TEXT | `'telegram'`, `'csv_ok_import'`, `'manual'`, `'estimated_from_snapshot'` |
| `source_record_id` | TEXT NULL | связь с импортом (id строки в CSV из «ОК») |
| `created_at` | TEXT | момент создания на клиенте |
| `synced_at` | TEXT NULL | момент попадания в локальный SQLite |
| `deleted_at` | TEXT NULL | soft delete (для возможной правки/удаления с телефона) |

### Snapshots (балансы для верификации)
| Поле | Тип | Описание |
|---|---|---|
| `id` | TEXT PK | UUID |
| `date` | TEXT | на какую дату баланс |
| `account_id` | TEXT FK |  |
| `native_amount` | REAL | сумма в нативной валюте счёта |
| `source` | TEXT | `'manual'`, `'estimated_from_legacy'` |
| `note` | TEXT NULL |  |
| `created_at` | TEXT |  |

### Rates (курсы валют)
| Поле | Тип | Описание |
|---|---|---|
| `date` | TEXT (PK part) | дата |
| `base` | TEXT FK (PK part) | базовая |
| `quote` | TEXT FK (PK part) | котируемая |
| `rate` | REAL | 1 base = rate quote |
| `source` | TEXT | `'google'`, `'cbr'`, `'frankfurter'`, `'manual'`, `'derived'` |
| `fetched_at` | TEXT | момент сбора |

Сохраняем как пары: `(EUR, USD, 1.085)`, `(EUR, RUB, 95.4)`, ... Конкретно для дашборда base = `EUR`.

**Конвертация (ADR-014, SPEC-016).** Единственный путь перевести сумму в EUR / другую валюту — `RatesIndex` (`cloud/worker/src/rates.ts`) на worker; клиенты не делят на курс, а получают готовые `*_eur` поля. Какой курс брать: **запас** (баланс в моменте — вёдра, net worth, goal balance) → курс на сегодня (`rateAt(today)`, mark-to-market); **поток** (операция на дату — расход, доход, day-total) → курс на дату операции (`rateAt(date)`, date-aware). `rateAt` берёт ближайший курс с `date ≤ target` (нет точного — fallback назад, не 0).

### Sync state (служебная)
| Поле | Тип |
|---|---|
| `key` | TEXT PK |
| `value` | TEXT |
| `updated_at` | TEXT |

Ключи: `last_synced_at`, `last_xlsx_regenerated_at`, `last_rates_fetched_at`, ...

## D1 (облако) — урезанная схема

Только то, что нужно Mini App для UI и для outbox.

### `expenses_outbox`
То же что `expenses` в локальной схеме, плюс:
| Поле | Тип | Описание |
|---|---|---|
| `user_id` | TEXT | Telegram user ID — кто записал |
| `confirmed_at` | TEXT NULL | когда MacBook подтвердил приём |

После confirmation cron удалит запись через 7 дней.

### `accounts`, `categories`, `currencies`
Read-mostly справочники. Mini App грузит их при старте для построения UI. Обновляются с MacBook командой `sync.py --push-references`.

### `authorized_users`
| Поле | Тип |
|---|---|
| `telegram_id` | TEXT PK |
| `name` | TEXT |
| `created_at` | TEXT |

По умолчанию одна запись — владелец.

### `rate_limit` (опционально)
Простая bucket-табличка для защиты от спама. Не критично для Этапа 1.

## Идентификаторы и нейминг

- **UUID** v4 для всех PK сущностей, кроме справочников.
- **Справочники** (owners/currencies/accounts/categories) — semantic ID в kebab-case, чтобы их можно было упоминать в SQL и коде без хеша. Пример: `acc_sber_rub_deposit`, `cat_food_groceries`.
- **Все timestamps** — ISO 8601 в UTC, хранятся как TEXT (`'2026-05-23T10:42:01Z'`).
- **Денежные суммы** — REAL. SQLite не имеет DECIMAL, но REAL хватает для personal finance (точность ~15 значащих цифр).

## Миграции

`local/migrations/` содержит нумерованные SQL-файлы:
```
001_init.sql
002_add_chain_id_to_transactions.sql
003_add_investments_table.sql
...
```

`local/scripts/init_db.py` применяет их по порядку, отслеживает применённые в служебной таблице `_migrations`.

**Правило:** существующие миграции — immutable. Изменения структуры — только новой миграцией.

D1 миграции — через `wrangler d1 migrations`. Аналогично нумеруются в `cloud/worker/migrations/`.

## Производные представления

Балансы по счетам, агрегаты по группам, динамика капитала — не хранятся, **вычисляются** в `regenerate_xlsx.py`. Это гарантия консистентности: одна формула, один результат.

```sql
-- Пример: текущий баланс счёта
SELECT
  a.id, a.name, a.currency,
  COALESCE(SUM(CASE WHEN t.to_account = a.id THEN t.amount_in ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.from_account = a.id THEN t.amount_out ELSE 0 END), 0)
  - COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id = a.id AND deleted_at IS NULL), 0)
  AS computed_balance
FROM accounts a
LEFT JOIN transactions t ON (t.from_account = a.id OR t.to_account = a.id)
GROUP BY a.id;
```

Для дашборда сравниваем `computed_balance` с последним `snapshot.native_amount` — разница = `implicit_cashflow` (не записанные мелкие траты).
