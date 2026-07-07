---
id: SPEC-008
title: Stage 7.5 — Транзакции / обмены / цепочки (transactions)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - revised_by: SPEC-012  # chains полностью откачены
  - adr: docs/decisions.md#adr-011
  - adr: docs/decisions.md#adr-012
  - adr: docs/decisions.md#adr-013
  - parent: docs/roadmap.md#этап-75--транзакции--обмены--цепочки
  - depends_on: [SPEC-005, SPEC-006, SPEC-007]
---

# Stage 7.5 — Транзакции / обмены / цепочки (transactions)

## 1. Context & Problem

После Stages 4–7 у нас есть учёт доходов, расходов, балансов и целей,
но **нет механизма для движений между вёдрами без изменения общего
net worth**. Реальный кейс пользователя:
«поменял 100 000 RUB на USDT» — это перетасовка между двумя bucket'ами
(RUB·банк → USDT) по конкретному курсу. Сейчас единственный путь —
вручную обновить два снапшота, что:
- не сохраняет факт операции (когда, по какому курсу, какая комиссия),
- не позволяет посчитать эффективный курс / PnL по обменам,
- ломает аналитику expenses/incomes (обмен — не доход и не расход).

Также пользователь хочет **цепочки** (chain): «RUB → USDT → EUR» как
один акт с фиксированным total PnL, чтобы оценивать спред по всей
лестнице конвертаций.

## 2. Goals

- G1: В D1 появилась таблица `transactions` с типами
  `exchange` (разные валюты, обязательный rate) и `transfer` (та же
  валюта, разные вёдра) + nullable `chain_id` для группировки
  multi-step операций.
- G2: Worker предоставляет CRUD `/v1/web/transactions` через Bearer JWT
  + endpoint `/v1/web/chains/:chain_id` для просмотра цепочки целиком
  с computed total PnL.
- G3: **Auto-snapshot обоих вёдер** при создании transaction — Worker
  атомарно (`env.DB.batch`) пишет transaction + 2 snapshots:
  - from bucket: `prev_latest_balance − from_amount`
  - to bucket:   `prev_latest_balance + to_amount`
  Snapshot.source = `'auto_transaction'`, snapshot.date = tx.date.
  Если для bucket нет предыдущего snapshot'а — `prev=0`, snapshot
  становится первым (со знаком, может быть отрицательным; UI выведет
  warning).
- G4: Web Admin: страница `/transactions` — список с фильтрами
  (период, тип, валюты, ведро), кнопки `+ Обмен` и `+ Перевод`,
  отдельная `+ Цепочка` для builder'а.
- G5: Modal create:
  - `+ Обмен`: from_account → from_amount, to_account → to_amount.
    Computed rate отображается рядом как подпись («1 USDT ≈ 82.5 RUB»).
    Опциональные `fee_amount` + `fee_currency` (если nullable —
    означает «комиссия включена в курс»).
  - `+ Перевод`: from_account → to_account (одна валюта, валидируем),
    amount, опциональный fee.
  - `+ Цепочка`: builder из N звеньев (минимум 2). Каждое звено
    разделяет from_amount → to_amount. UI показывает накопительный
    эффективный курс (`final_to / initial_from`).
- G6: Список transactions показывает chain badge для записей с
  `chain_id`; клик по badge → `/chains/:id` с total PnL.
- G7: Goal_id на transactions — **nullable FK** для будущего withdraw
  из goal (Stage 8+). Сейчас не используется, поле зарезервировано.
- G8: Sidebar добавляет «Обмены» (был disabled), иконка `ArrowRightLeft`.
- G9: На `/accounts` карточка ведра остаётся «балансом = последний
  snapshot» — auto-snapshots из transaction'ов попадают сюда
  автоматически. Дополнительно: bucket card имеет subtitle «N обменов
  за месяц» если они есть.

## 3. Non-Goals

- NG1: **Withdraw из goal как тип** — `goal_id` поле есть в схеме, но
  тип `withdraw_goal` не реализуется в этой итерации. Spend из goal
  через transaction — Stage 8.
- NG2: **Связь transaction → expense** (например, комиссия как отдельный
  expense) — не делаем. Fee хранится как поле в transaction.
- NG3: **Auto-сравнение с market rate / spread analytics** — это
  Stage 8 Dashboard. Эффективный курс отображаем, но не сравниваем с
  историческим Google Finance rate.
- NG4: **Edit transaction** — в этой итерации только create + delete.
  Edit сложен из-за каскадно-зависимых snapshots; добавим в Stage 7.5.1
  при необходимости.
- NG5: **Mini App** — обмены остаются Web Admin only (ADR-012).
- NG6: **Привязка expense.account_id к transaction** — расходы остаются
  независимыми.
- NG7: **Recurring transactions** — нет авто-генерации.
- NG8: **Историческое восстановление** retroactive с пересчётом всех
  будущих snapshots — нет. Если transaction.date в прошлом, новые
  snapshots появляются на эту дату, но «прошлые» snapshots не
  модифицируются. Это может вызвать short-term inconsistency для
  retroactive ввода — пометить как known limitation.

## 4. User journeys

### Happy path — обмен RUB → USDT (пользовательский кейс)
1. Стёпа открывает `/transactions`, жмёт `+ Обмен`.
2. Модал:
   - Дата: сегодня (default).
   - Откуда: `RUB · банк`. From amount: `100 000`.
   - Куда: `USDT`. To amount: `1 212.12`.
   - Под полями автоматически появляется badge: «Курс: 1 USDT = 82.50 RUB».
   - Комиссия (опц.): не задана.
   - Заметка (опц.): «через Garantex P2P».
3. Жмёт «Создать». В D1 batch:
   - INSERT transaction.
   - INSERT snapshot (RUB·банк, date=today, amount=prev_RUB_balance − 100 000, source='auto_transaction').
   - INSERT snapshot (USDT, date=today, amount=prev_USDT_balance + 1 212.12, source='auto_transaction').
4. Возвращается на `/accounts`. Карточка `RUB·банк` показывает новый
   баланс − 100k, `USDT` +1212.

### Happy path — цепочка RUB → USDT → EUR
1. Стёпа открывает `/transactions`, жмёт `+ Цепочка`.
2. Builder показывает 2 звена (можно добавлять):
   - Звено 1: `RUB·банк` 100 000 RUB → `USDT` 1 212.12 USDT.
   - Звено 2: `USDT` 1 212.12 USDT → `EUR·банк` 1 042.78 EUR.
   - Подсказка снизу: «Эффективный курс: 1 EUR ≈ 95.90 RUB» (computed
     из initial RUB / final EUR).
3. Жмёт «Создать цепочку». Worker:
   - Генерит общий `chain_id` (UUID).
   - INSERT 2 transactions с этим chain_id (sequence 1, 2).
   - Auto-snapshots для всех затронутых вёдер по каждому звену
     (RUB−, USDT+, USDT−, EUR+ — 4 snapshots, по 2 на звено).
4. Список показывает 2 строки с badge «🔗 Цепочка». Клик → `/chains/:id`
   с детальной разбивкой и total PnL.

### Happy path — transfer (RUB·банк → RUB·наличка)
1. `+ Перевод`: from `RUB·банк`, to `RUB·нал`, amount `5 000 RUB`.
2. Валидация: from_currency === to_currency (UI блокирует разные
   валюты для transfer — для них есть exchange).
3. Comput: rate всегда 1.0 (не отображается).
4. Auto-snapshots: RUB·банк −5k, RUB·нал +5k.

### Edge cases
- E1: **Нет previous snapshot для bucket** — prev = 0; auto-snapshot
  начнётся со значения `0 ± delta`. UI показывает warning на карточке
  bucket'а: «Баланс начат с обмена — проверьте корректность».
- E2: **from_account === to_account** — backend 400 «from and to must differ».
- E3: **from_amount ≤ 0 или to_amount ≤ 0** — 400 «amounts must be positive».
- E4: **transfer с разными валютами** — backend 400 «transfer requires same currency; use exchange».
- E5: **Цепочка из 1 звена** — backend 400 «chain requires at least 2 steps» (для одиночной операции используй `+ Обмен`).
- E6: **Цепочка с разрывом (звено 1.to ≠ звено 2.from)** — backend
  валидирует sequence consistency: `tx[i].to_account_id === tx[i+1].from_account_id`. 400 при нарушении.
- E7: **Цепочка с разными to_amount[i].to vs from_amount[i+1].from** —
  допускается (разница = spread/комиссия внутри цепочки между этапами).
- E8: **Retroactive transaction** (date < latest snapshot of bucket) —
  разрешено. Auto-snapshots создаются на tx.date. Latest snapshot
  computation продолжает работать. Может создать «прошлое-future»
  inconsistency, но это знаемое ограничение (см. NG8).
- E9: **DELETE transaction** — soft-delete tx + soft-delete связанных
  auto-snapshots (`WHERE source='auto_transaction' AND метаdata link`).
  Реализация: дополнительный FK `snapshots.transaction_id` → можно
  откатить. Если snapshot был отредактирован пользователем (source
  стал `manual` или amount изменён) — оставляем.
- E10: **Курсы валют отсутствуют** для пары — на rate computation
  не влияет (rate = to/from, не использует курсы). Но если потребуется
  EUR-eq оценка — `null`.

## 5. Data model

### Миграция 0009 (D1)

```sql
-- cloud/worker/migrations/0009_transactions.sql

-- ─── Транзакции (exchange + transfer) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL CHECK (type IN ('exchange','transfer')),
    date             TEXT NOT NULL,                              -- YYYY-MM-DD
    from_account_id  TEXT NOT NULL REFERENCES accounts(id),
    to_account_id    TEXT NOT NULL REFERENCES accounts(id),
    from_amount      REAL NOT NULL CHECK (from_amount > 0),
    from_currency    TEXT NOT NULL REFERENCES currencies(code),  -- денормализация
    to_amount        REAL NOT NULL CHECK (to_amount > 0),
    to_currency      TEXT NOT NULL REFERENCES currencies(code),
    fee_amount       REAL CHECK (fee_amount IS NULL OR fee_amount >= 0),
    fee_currency     TEXT REFERENCES currencies(code),
    note             TEXT,
    chain_id         TEXT,                                       -- UUID, NULL = одиночная
    chain_sequence   INTEGER,                                    -- 1..N в цепочке, NULL для одиночек
    goal_id          TEXT REFERENCES goals(id),                  -- зарезервировано Stage 8
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_chain   ON transactions(chain_id, chain_sequence);
CREATE INDEX IF NOT EXISTS idx_transactions_from    ON transactions(from_account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_to      ON transactions(to_account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_active  ON transactions(date) WHERE deleted_at IS NULL;

-- ─── Связь snapshot → transaction (для каскадного отката при delete) ──────
ALTER TABLE snapshots ADD COLUMN transaction_id TEXT REFERENCES transactions(id);
CREATE INDEX IF NOT EXISTS idx_snapshots_transaction ON snapshots(transaction_id);
```

### Семантика полей и инварианты

- **`type`** — `exchange` (валюта меняется) или `transfer` (валюта
  одинаковая). Backend валидирует:
  - `exchange`: `from_currency !== to_currency`.
  - `transfer`: `from_currency === to_currency`.
- **`from_currency`/`to_currency`** — денормализация из
  `accounts.currency` для скорости и историчности (если когда-то
  переименуем account → не меняем уже записанную tx).
- **`rate`** — НЕ хранится в таблице, computed = `to_amount / from_amount`
  в Worker (или клиент). Защита от drift при changing amounts.
- **`fee_amount`/`fee_currency`** — nullable, опциональная комиссия,
  отдельным полем для tracking без вычитания из amounts.
- **`chain_id`** — nullable UUID. Если задан → транзакция часть цепочки.
- **`chain_sequence`** — порядок звена в цепочке (1..N), NULL для
  одиночек. Уникальность (chain_id, chain_sequence) — не enforced на
  уровне DB constraint (для простоты, валидируем в Worker).
- **`goal_id`** — зарезервировано. Сейчас всегда NULL.
- **Auto-snapshots invariant**: при INSERT transaction, в том же batch
  должны быть INSERT'нуты 2 snapshot'а с `transaction_id = tx.id` и
  `source = 'auto_transaction'`. При SOFT-DELETE transaction —
  SOFT-DELETE связанных snapshots.

### Что НЕ менялось

- `accounts`, `expenses`, `incomes`, `categories`, `currencies`,
  `rates`, `authorized_users`, `goals`, `goal_contributions`,
  `income_categories` — без изменений.
- `snapshots`: только добавлена nullable колонка `transaction_id`.

## 6. API contract

Все endpoints под `/v1/web/*` за Bearer JWT (`requireAdminSession`).

### `GET /v1/web/transactions`
Список транзакций.

- Query:
  - `limit` (default 1000, max 20000),
  - `from`, `to` (YYYY-MM-DD),
  - `type` (`exchange`|`transfer`),
  - `account_id` (фильтр на from/to),
  - `chain_id`.
- Response 200:
  ```json
  {
    "transactions": [
      {
        "id": "uuid",
        "type": "exchange",
        "date": "2026-05-25",
        "from_account_id": "rub-bank",
        "to_account_id": "usdt",
        "from_amount": 100000,
        "from_currency": "RUB",
        "to_amount": 1212.12,
        "to_currency": "USDT",
        "fee_amount": null,
        "fee_currency": null,
        "note": "через Garantex P2P",
        "chain_id": null,
        "chain_sequence": null,
        "goal_id": null,
        "created_at": "..."
      }
    ]
  }
  ```

### `GET /v1/web/chains/:chain_id`
Цепочка целиком + computed total PnL.

- Response 200:
  ```json
  {
    "chain_id": "uuid",
    "transactions": [ ...sorted by chain_sequence... ],
    "initial": { "account_id": "rub-bank", "amount": 100000, "currency": "RUB" },
    "final":   { "account_id": "eur-bank", "amount": 1042.78, "currency": "EUR" },
    "effective_rate": 0.01042,
    "step_count": 2
  }
  ```

### `POST /v1/web/transactions`
Создание одиночной транзакции + 2 auto-snapshots в batch.

- Body:
  ```json
  {
    "id": "uuid",                       // optional
    "type": "exchange" | "transfer",
    "date": "2026-05-25",
    "from_account_id": "rub-bank",
    "to_account_id": "usdt",
    "from_amount": 100000,
    "to_amount": 1212.12,
    "fee_amount": null,                 // optional
    "fee_currency": null,               // optional
    "note": "..."                       // optional
  }
  ```
- Response 200:
  ```json
  {
    "ok": true,
    "id": "...",
    "inserted": true,
    "snapshot_ids": ["uuid1", "uuid2"]
  }
  ```
- 400:
  - `from_account_id and to_account_id must differ`
  - `from_amount and to_amount must be positive`
  - `transfer requires from_currency === to_currency`
  - `exchange requires from_currency !== to_currency`
  - `unknown account_id` / `unknown currency_code`

### `POST /v1/web/chains`
Создание цепочки (2+ транзакций).

- Body:
  ```json
  {
    "chain_id": "uuid",                 // optional
    "date": "2026-05-25",               // используется для всех звеньев
    "note": "...",                      // optional, на chain-уровне (попадает в каждое звено)
    "steps": [
      {
        "type": "exchange",
        "from_account_id": "rub-bank",
        "to_account_id": "usdt",
        "from_amount": 100000,
        "to_amount": 1212.12,
        "fee_amount": null,
        "fee_currency": null
      },
      { ... step 2 ... }
    ]
  }
  ```
- Backend валидирует:
  - `steps.length >= 2`
  - Для каждого step — те же правила, что у POST /v1/web/transactions
  - Sequence consistency: `steps[i].to_account_id === steps[i+1].from_account_id`
- Response 200:
  ```json
  {
    "ok": true,
    "chain_id": "...",
    "transaction_ids": ["uuid1", "uuid2"],
    "snapshot_ids": [...]
  }
  ```

### `DELETE /v1/web/transactions/:id`
Soft-delete transaction + cascading soft-delete связанных snapshots.

- Response 200:
  ```json
  {
    "ok": true,
    "deleted": true,
    "deleted_snapshots": 2
  }
  ```
- Snapshots с `source='auto_transaction' AND transaction_id=tx.id` —
  soft-delete'аются. Snapshots с другим source — оставляются (user мог
  переопределить).

### `DELETE /v1/web/chains/:chain_id`
Удаляет всю цепочку (каждую транзакцию + связанные snapshots).

- Response 200:
  ```json
  { "ok": true, "deleted_transactions": 2, "deleted_snapshots": 4 }
  ```

### Никаких PUT endpoints в этой итерации (NG4).

## 7. UI / UX

### Маршрут `/transactions`

```
┌───────────────────────────────────────────────────────────────────────┐
│ Обмены                              [+ Обмен] [+ Перевод] [+ Цепочка] │
│ Перетасовки денег между вёдрами. Курс фиксируется в момент операции.  │
├───────────────────────────────────────────────────────────────────────┤
│ [PeriodPicker — week/month/30d/year/all/custom]                       │
├───────────────────────────────────────────────────────────────────────┤
│ [🔍 поиск          ] [▼ Тип] [▼ Ведро]                                │
├──────┬──────────┬────────────┬──────────┬─────────────┬───────────────┤
│ Дата │ Тип      │ Откуда     │ Куда     │   Сумма     │ Курс / chain  │
├──────┼──────────┼────────────┼──────────┼─────────────┼───────────────┤
│25.05 │💱 обмен  │RUB·банк    │USDT      │100 000 RUB  │82.50 RUB/USDT │
│      │          │  −100 000  │ +1 212.12│  → 1 212.12 │               │
│      │          │            │          │      USDT   │               │
│25.05 │💱 обмен  │USDT        │EUR·банк  │1 212.12 USDT│ 1.163 USDT/EUR│
│      │🔗 ch:abc│ −1 212.12  │ +1 042.78│  →1 042.78  │               │
│      │          │            │          │      EUR    │               │
│24.05 │↔ перевод │RUB·банк    │RUB·нал   │5 000 RUB    │ —             │
│      │          │  −5 000    │ +5 000   │             │               │
└──────┴──────────┴────────────┴──────────┴─────────────┴───────────────┘
```

- **PeriodPicker** работает как в incomes / expenses.
- **Тип badge**: 💱 exchange, ↔ transfer; chain — отдельный 🔗 badge с
  prefix chain_id (4 первые символа) кликабельный на `/chains/:id`.
- **Сумма** колонка показывает обе стороны (двухстрочно).
- **Курс** колонка — `(to/from)` или `(from/to)` formatted по
  user-friendly direction (большее число впереди).
- **Действия**: `🗑` удалить.

### Маршрут `/chains/:chain_id`

```
┌───────────────────────────────────────────────────────────────────────┐
│ ← Обмены        🔗 Цепочка abc12345          [🗑 Удалить цепочку]    │
├───────────────────────────────────────────────────────────────────────┤
│ Начальная позиция:  100 000 🇷🇺 RUB (RUB·банк)                       │
│ Конечная позиция:   1 042.78 🇪🇺 EUR (EUR·банк)                      │
│ Эффективный курс:   1 EUR ≈ 95.90 RUB                                 │
│ 2 шага · 25.05.2026                                                   │
├───────────────────────────────────────────────────────────────────────┤
│ Шаги цепочки:                                                         │
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │ 1. RUB·банк ─→ USDT                                              │  │
│ │    100 000 RUB ──── 82.50 RUB/USDT ──→ 1 212.12 USDT             │  │
│ │ 2. USDT ─→ EUR·банк                                              │  │
│ │    1 212.12 USDT ── 1.163 USDT/EUR ──→ 1 042.78 EUR              │  │
│ └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

### Modal `+ Обмен`

```
┌─────────────────────────────────────────┐
│ Новый обмен                          ✕  │
├─────────────────────────────────────────┤
│ Дата                                    │
│ [2026-05-25                          ▼] │
│                                         │
│ Откуда                                  │
│ [🇷🇺 RUB·банк                        ▼] │
│ [100 000                          ] RUB │
│                                         │
│ Куда                                    │
│ [₮ USDT                              ▼] │
│ [1212.12                         ] USDT │
│                                         │
│ ┌─ 💱 Курс: 1 USDT = 82.50 RUB  ─────┐  │
│ └────────────────────────────────────┘  │
│                                         │
│ Комиссия (опц.)        Валюта           │
│ [                  ]  [— или валюта ▼]  │
│                                         │
│ Заметка (опц.)                          │
│ [                                    ]  │
│                                         │
│         [Отмена]  [Создать]             │
└─────────────────────────────────────────┘
```

- Валидация:
  - `from_account_id !== to_account_id`
  - `from_amount > 0 && to_amount > 0`
  - `from.currency !== to.currency` (для exchange)
- Computed rate в badge — обновляется live при изменении сумм.
- Submit disabled пока invalid.

### Modal `+ Перевод`
- То же, но from и to ограничены вёдрами **одинаковой валюты** (filter в
  select). Поле amount одно (показывается как `from_amount = to_amount`).
- Computed rate скрыт (всегда 1).

### Modal `+ Цепочка` (builder)

```
┌─────────────────────────────────────────────────────────────┐
│ Новая цепочка                                            ✕  │
├─────────────────────────────────────────────────────────────┤
│ Дата: [2026-05-25]                                          │
│                                                             │
│ Звено 1                                                     │
│ ┌─ Откуда: [🇷🇺 RUB·банк ▼] ─── [100 000        ] RUB ──┐  │
│ │  Куда:   [₮ USDT       ▼] ─── [1 212.12       ] USDT │  │
│ │  Курс: 1 USDT = 82.50 RUB                              │  │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Звено 2                              [🗑]                   │
│ ┌─ Откуда: [₮ USDT       ▼] ─── [1 212.12       ] USDT ──┐  │
│ │  Куда:   [🇪🇺 EUR·банк▼] ─── [1 042.78       ] EUR  │  │
│ │  Курс: 1 EUR = 1.163 USDT                              │  │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [+ Добавить звено]                                          │
│                                                             │
│ ┌─ Итого: 100 000 RUB → 1 042.78 EUR ─────────────────┐    │
│ │  Эффективный курс: 1 EUR = 95.90 RUB                 │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                             │
│ Заметка (опц.): [                                       ]   │
│                                                             │
│              [Отмена]  [Создать цепочку]                    │
└─────────────────────────────────────────────────────────────┘
```

- Каждое звено — карточка с from + to.
- `+ Добавить звено`: добавляет следующее звено, его `from_account_id`
  по умолчанию = предыдущего звена `to_account_id` (хорошая
  consistency-подсказка).
- Builder показывает live total effective rate.
- Submit disabled пока:
  - звеньев >= 2
  - все звенья валидны
  - chain consistency: `steps[i].to_account_id === steps[i+1].from_account_id`
    (либо warning, либо block — block).

### Sidebar

`Обмены` (был disabled). Иконка `ArrowRightLeft`. Активный state работает
для `/transactions` и `/chains/:id` (через startsWith).

### AccountsPage добавление

В bucket card, под балансом — мелкая подпись:
```
от 24.05.2026 · 3 обмена в этом месяце
```

(`3 обмена` — количество transactions where from_account_id=this OR
to_account_id=this за current month; считается во фронте по
`useTransactions` cache.)

## 8. Security

- **Auth.** Все endpoints под `requireAdminSession`. Mini App не имеет
  доступа.
- **Input validation.**
  - `type`: enum check.
  - `date`: ISO regex.
  - `from_account_id`, `to_account_id`: FK + must differ.
  - `from_amount`, `to_amount`: > 0.
  - `from_currency`/`to_currency`: derived from accounts (не от клиента).
  - `fee_amount`: ≥ 0 if present; requires `fee_currency`.
  - Для exchange: from.currency !== to.currency.
  - Для transfer: from.currency === to.currency.
  - Для chain: steps.length ≥ 2; sequence consistency.
- **Idempotency.** UUID + INSERT OR IGNORE (для chain — atomic batch).
- **PII.** Note может содержать «Garantex», «обмен у Серёги» — не
  логируем suma/note.
- **CORS.** Через shared `cors.ts`.
- **Atomic batches.** Worker использует `env.DB.batch` для insert
  transaction + 2 snapshots — если что-то падает, ничего не пишется.
  Для chain — batch с 2N + N inserts.

## 9. Acceptance criteria

- [ ] AC1: Миграция 0009 применима; `transactions` есть, `snapshots`
  имеет колонку `transaction_id`.
- [ ] AC2: POST /v1/web/transactions с валидным exchange-body создаёт
  1 transaction + 2 snapshots в одном batch. Response содержит
  snapshot_ids.
- [ ] AC3: POST с from_account == to_account → 400.
- [ ] AC4: POST exchange с from.currency === to.currency → 400.
- [ ] AC5: POST transfer с from.currency !== to.currency → 400.
- [ ] AC6: POST с from_amount = 0 или отрицательным → 400.
- [ ] AC7: Auto-snapshot from_bucket: `latest.amount − from_amount`
  на правильную дату.
- [ ] AC8: Auto-snapshot to_bucket: `latest.amount + to_amount`
  на правильную дату.
- [ ] AC9: Если у bucket нет previous snapshot, prev = 0; новый
  snapshot создаётся.
- [ ] AC10: GET /v1/web/transactions фильтрует по period/type/account/chain.
- [ ] AC11: POST /v1/web/chains с 2 steps создаёт 2 transactions с одним
  chain_id и chain_sequence 1, 2. Snapshots создаются для каждого
  звена.
- [ ] AC12: POST /v1/web/chains с 1 step → 400.
- [ ] AC13: POST /v1/web/chains с inconsistent sequence
  (`step[0].to != step[1].from`) → 400.
- [ ] AC14: GET /v1/web/chains/:chain_id возвращает chain + computed
  initial/final/effective_rate.
- [ ] AC15: DELETE transaction soft-delete'ает её и связанные snapshots
  (`source='auto_transaction' AND transaction_id=tx.id`).
- [ ] AC16: DELETE chain soft-delete'ает все её transactions + связанные
  snapshots.
- [ ] AC17: `/transactions` page показывает список + кнопки + filters;
  Sidebar Обмены активен.
- [ ] AC18: `/chains/:id` показывает chain details.
- [ ] AC19: AccountsPage bucket card подпись `N обменов в этом месяце`
  (если есть).
- [ ] AC20: Регрессии — `/expenses`, `/incomes`, `/snapshots`, `/goals`
  не сломались.

## 10. Test plan

### Worker curl smoke
- POST /transactions exchange happy → 200, snapshot_ids = 2.
- POST все 400 кейсы (AC3-AC6).
- POST /chains 2 step → 200.
- POST /chains inconsistent → 400.
- GET с filters.
- DELETE с проверкой cascade snapshots.

### D1 smoke
- После create: `SELECT * FROM snapshots WHERE transaction_id IS NOT NULL` → 2 rows.
- После delete: `SELECT deleted_at FROM snapshots WHERE transaction_id = X` → NOT NULL.

### Admin Playwright
- /transactions empty → empty state.
- Open Modal `+ Обмен`, fill, submit, see new row in list.
- Open Modal `+ Цепочка`, add 2 links, see chain badge in list.
- Click chain badge → /chains/:id detail page.
- DELETE row → row disappears, accounts balances refresh.

### Mini App regression
- Запустить трату → ничего не сломалось.

## 11. Risks & open questions

- R1: **Auto-snapshot retroactive write** — если tx.date < last snapshot
  bucket'а, новые snapshots вставляются в прошлое, но не модифицируют
  future. Это создаёт несогласованность. Митigation: документировать,
  Stage 8 добавим «пересчитать historical chain».
- R2: **Atomic batch limits в D1** — для chain из N звеньев = 1 + 2N
  inserts. D1 batch поддерживает до 50 statements. Для N ≤ 20 ok.
  Защита в Worker: `steps.length <= 10` (security guard).
- R3: **transaction_id на snapshots** — добавляет FK, теоретически
  ограничивает delete account / transaction caskады. У нас soft-delete
  по transaction → snapshots, поэтому FK работает logically.
- R4: **Computed rate в UI** — `to/from` для обмена дает rate в
  единицах "to per from". User-facing: для USDT/RUB обычно показывают
  «1 USDT = 82 RUB» (rate inversed). UI должен flip направление если
  rate < 1: `if (rate < 1) flip → 1 from = N to`. Документировать.
- OQ1: **Edit transaction** — отложено в NG4. Если важно с самого
  начала, добавим в Stage 7.5.1.
- OQ2: **Fee impact on rate** — если fee в одной из валют tx, нужно ли
  её учитывать в effective rate? Сейчас computed rate = to_amount /
  from_amount (без fee adjustment). User видит сырой курс.
- OQ3: **Симметрия auto-snapshot для incomes/expenses** (идея от
  пользователя, 2026-05-25). Если auto-snapshot работает для
  exchange/transfer, логично делать то же для incomes (`+amount` в
  bucket) и expenses (`−amount`). Тогда:
  - Net worth всегда реал-тайм без необходимости вручную вносить
    снапшот после каждой зарплаты.
  - «Истинный» snapshot из банк-выписки (quarterly / по запросу)
    становится **сверкой**: разница между computed и factual = скрытые
    комиссии, проценты, банковские ошибки. Это полезный signal.
  - **Минусы**: 1822 существующих expense потребуют backfill snapshots
    (миграция); каждый POST/PUT/DELETE expense + income должен делать
    batch'ем snapshot mutation; retroactive операции сложнее (нужно
    пересчитывать computed balance с правильным prev). Не делается в
    Stage 7.5 из-за объёма — добавлено в roadmap как Stage 7.5.1.
  - Возможный подход: ввести понятие `auto_event` snapshot (source) и
    тонкий helper `applyDelta(env, account_id, date, delta,
    source_ref)` использующийся всеми тремя доменами
    (expense / income / transaction).

## 12. Out of scope для review

- Withdraw из goal через transaction (Stage 8).
- Auto-сравнение с market rate (Stage 8).
- Graphs: exchange volume over time, spread analysis (Stage 8).
- Recurring exchanges (Stage 10 AI coach).
- Mini App.
- Edit transaction.

## 13. Changelog spec'а

- 2026-05-25: создан в `draft`. Discovery: exchange + transfer + chain
  builder; auto-snapshot обоих ведер; rate computed from amounts.
- 2026-05-25: `in_progress` (старт Phase 2).
- 2026-05-25: Phase 2 — миграция 0009 + Worker `v d5abb512` + Admin SPA
  задеплоены. Live: `finances-admin.pages.dev/transactions`.
- 2026-05-25: Phase 3 audit. QA PASS_WITH_SHOULDS (1 M, ~5 S),
  Arch APPROVED_WITH_SHOULDS (0 M, 6 S). Применены critical fixes:
  - **M1**: `createChain` теперь atomic — один `env.DB.batch(allStmts)`
    на всю цепочку (3N statements) с virtual-delta map для корректного
    prev_balance внутри chain'а. Partial commits исключены.
  - **S**: `transfer` валидирует `from_amount === to_amount`.
  - **S**: `loadAccount` проверяет `is_active = 1` (inactive вёдра
    недоступны).
  - **S**: snapshot INSERT через `OR IGNORE` (защита от retry дубликата).
  - **S**: `listSnapshots` возвращает `transaction_id`.
  - **S**: SnapshotsPage помечает `auto_transaction` бэйджем «auto» и
    блокирует edit/delete (защита cascade-инварианта).
  - **Fix**: rate display перевёрнут корректно — «1 USDT = 82.50 RUB»
    вместо ранее «1 RUB = 82.5 USDT». Wynesен в `formatExchangeRate()`.
  Отложено в roadmap: chain idempotency (uniqueness constraint),
  AC19 (N обменов на bucket card), AC9 UI warning prev=0,
  data-model.md update.
- 2026-05-25: статус `done`. Roadmap обновлён.
- 2026-07-07: обратный superseded-маркер (аудит 2026-07, SPC-08): фича chains (multi-step цепочки, `chain_id`/`chain_sequence`) полностью откачена SPEC-012 — chain-эндпоинты и UI удалены, колонки спят до миграции удаления (~08-2026). Актуальный scope транзакций — exchange/transfer без цепочек.
