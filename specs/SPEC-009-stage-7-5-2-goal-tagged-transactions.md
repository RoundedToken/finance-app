---
id: SPEC-009
title: Stage 7.5.2 — Goal-tagged transactions + saga workflow
status: cancelled
superseded_by: SPEC-012
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - adr: docs/decisions.md#adr-011
  - adr: docs/decisions.md#adr-012
  - adr: docs/decisions.md#adr-013
  - parent: specs/SPEC-007-stage-7-goals.md
  - parent: specs/SPEC-008-stage-7-5-transactions.md
---

# Stage 7.5.2 — Goal-tagged transactions + saga workflow

## 1. Context & Problem

После Stage 7 (goals) и Stage 7.5 (transactions/chains) у нас:
- Goal balance = `SUM(incomes converted to target_currency) +
  SUM(goal_contributions converted)`.
- Транзакции могут иметь `goal_id` поле (зарезервировано в Stage 8 в
  схеме 0009), но **сейчас не используется**.
- Цепочки (chains) фиксируют факт «100 000 RUB → USDT → EUR» но не
  знают, что эти 100k были из ипотечного фонда.

Кейс пользователя: «родители подарили 100k RUB → я их обменял через
Garantex в USDT → потом в EUR». Все три события (income + 2 tx)
относятся к одной цели «Стартовый депозит на квартиру». Сейчас:
- Income привязан к goal → balance += 1210 EUR.
- Exchange 100k RUB → USDT 1212.12: **не связан с goal**, факт
  потерян. Goal думает что 100k RUB всё ещё лежат в RUB·банке.
- Chain RUB→USDT→EUR будет дальше — снова без связи.

**Что должно быть:**
1. Каждый exchange/transfer/chain можно tag'нуть `goal_id` — «эти
   деньги движутся внутри ипотечного фонда».
2. Goal balance учитывает spread loss при конверсии (1210 EUR из
   100k RUB → 1045 EUR после спреда → balance показывает 1045 EUR).
3. Workflow «Продолжить цепочку» — клик на existing exchange открывает
   chain builder с заполненным первым звеном (continuing the saga).

## 2. Goals

- G1: `transactions.goal_id` — обязательное поле UI для goal-tagging.
  Validate FK, optional (`null` = не привязано). Поле уже в схеме
  (миграция 0009).
- G2: Chain inherits `goal_id` на все свои звенья: одно поле в
  ChainCreatePayload, проксируется в каждый step. Mixed-goal chains
  не разрешены (одна цепочка = одна цель или null).
- G3: Goal balance расширен — **transactions с этим goal_id**
  добавляют delta: `+ (to_amount converted) − (from_amount converted)`
  в target_currency. Для exchange внутри goal это `−spread loss`. Для
  transfer (same currency) net = 0. Для tx-выхода из target_currency в
  другую — реальное снижение balance.
- G4: `GET /v1/web/goals/:id` возвращает unified timeline:
  `incomes + goal_contributions + transactions` с `goal_id=:id`.
  Sort by date DESC, marked source = `income|manual|exchange|transfer`.
- G5: GoalSelector reusable component (`src/components/GoalSelector.tsx`)
  — используется в IncomeModal + 3 transaction modals.
- G6: Admin SPA:
  - ExchangeModal / TransferModal — новое поле «Цель (опц.)».
  - ChainModal — одно поле «Цель» на всю цепочку (наследуется в steps).
  - GoalDetailPage timeline — добавлены tx-rows с указанием spread
    loss колонкой.
- G7: Кнопка **«Продолжить цепочку»** на `TxRow` в `/transactions`:
  открывает ChainModal с заполненным первым звеном
  (`from_account = current.to_account`, `from_amount = current.to_amount`,
  `goal_id = current.goal_id`).

## 3. Non-Goals

- NG1: **Withdraw из goal как отдельный type** — это Stage 8. Сейчас
  exchange/transfer с goal_id может выводить деньги в другую валюту
  (track в balance через spread + currency change), но **семантически
  «вытащить наружу goal'а» не моделируем** — для этого user должен
  очистить `goal_id` при создании выводящей tx (или редактирование —
  edit transactions отложено).
- NG2: **Edit transaction (включая goal_id)** — отложено в Stage 8.
  Сейчас goal_id фиксируется на create.
- NG3: **Multi-goal chain** — одна цепочка = одна цель. Запрещаем
  смешанные.
- NG4: **Goal_id на incomes уже есть** (Stage 7), не меняем.
- NG5: **«Продолжить» из income** — не делаем (нет explicit
  to_account/to_amount у income — это просто положили в bucket).
- NG6: **Drift correction для historical rates** — balance считается
  по latest rate (как в Stage 7). Date-aware lookup отложен (см.
  Stage 7.5.0).
- NG7: **Mini App** — все изменения только в Web Admin.
- NG8: **Миграция данных** — `goal_id` на существующих tx пользователю
  предложить вручную: «у тебя есть transaction 100k RUB → USDT без
  цели; привязать к “Стартовый депозит”?» (на UI side note). Если
  нет — деплоим как есть, user сам отметит через UI после edit feature.
  Поскольку edit отсутствует — для существующего exchange RUB→USDT
  пользователя сделаем **manual SQL update** через wrangler, как мы
  делали для goal.target_currency.

## 4. User journeys

### Happy path — продолжить цепочку
1. Стёпа открывает `/transactions`. Видит row: 25.05.2026 ⇄ обмен
   RUB·банк → USDT, 100k RUB → 1212.12 USDT, через Garantex P2P.
   Цель пустая (создавал до Stage 7.5.2).
2. Кликает на этот row → кнопка «Продолжить цепочку» рядом с trash.
   (Или это action в overflow menu — TBD UI.)
3. Открывается ChainModal с заполненными полями:
   - Звено 1: `RUB·банк` 100 000 RUB → `USDT` 1212.12 USDT
     (read-only, ссылка на исходную tx).
   - Звено 2: from = USDT (auto), from_amount = 1212.12 (auto),
     to пустое.
   - Goal: «Стартовый депозит» (если goal_id был на исходной tx).
4. Заполняет: to = `EUR·банк`, to_amount = 1042.78 EUR.
5. «Создать цепочку». Backend:
   - Existing tx remains как было (одиночная).
   - Создаётся новая chain — но первое звено = existing tx? Нет, **chain включает только новые звенья**. Existing остаётся отдельной.
   - **Альтернатива (выбрано)**: новая chain создаёт **только новые
     transactions** + existing tx обновляется добавляя `chain_id` и
     `chain_sequence=1`. Это «retroactive grouping».
6. Goal balance пересчитывается: добавляется delta от обеих
   transactions.

### Happy path — goal-tag при создании
1. `+ Обмен`, заполняет fields, под секцией «Заметка» — поле «Цель
   (опц.)» с GoalSelector.
2. Выбирает «Стартовый депозит».
3. Submit → tx создаётся с goal_id. На GoalDetailPage в timeline
   появляется row tx с пометкой «обмен · −165 EUR на спреде».

### Edge cases
- E1: **Mixed goal_id в chain** — backend 400 «chain must have one
  goal_id or none».
- E2: **Goal_id на transaction после удаления goal** — backend
  валидирует goal exists; если goal был soft-deleted уже после tx —
  не критично, FK не constraint'ит (D1 не enforces в ALTER ADD
  COLUMN), но display fallback'нется на «удалённая цель».
- E3: **Spread loss для transfer (same currency)** — `from_in_target =
  to_in_target`, loss = 0. Balance не меняется.
- E4: **Tx без goal_id** — balance не учитывает (как сейчас).
- E5: **«Продолжить» нажата на transfer (RUB·банк → RUB·нал)** —
  можно: следующее звено может быть exchange (RUB → USDT) или ещё
  один transfer. Builder открывается corretly.
- E6: **«Продолжить» на tx уже в chain** — добавляет новое звено в
  конец существующей chain (увеличивает `chain_sequence`). Нужна
  проверка: max sequence + 1.
- E7: **Goal в одной валюте, all tx в других** — balance computed
  через rates. Если rates отсутствуют для пары — фиксируется как
  `balance_missing_rates++`.

## 5. Data model

### Изменения схемы

Никаких новых таблиц. Используется существующее поле
`transactions.goal_id` (миграция 0009). Однако:

```sql
-- migrations/0010_goal_tagged_transactions.sql (опционально)
-- НЕТ изменений схемы; миграция-плейсхолдер для документирования
-- семантического сдвига. Можно пропустить.
```

Решение: миграцию **не создаём** — поле уже существует.

### Семантика расчёта balance

```
goal.balance (in target_currency) =
    SUM(income.amount converted to target, where income.goal_id = goal.id)
  + SUM(goal_contribution.amount converted to target, where goal_id)
  + SUM(transaction delta in target, where transaction.goal_id = goal.id)

где delta(tx) = convert(tx.to_amount, tx.to_currency, target)
              - convert(tx.from_amount, tx.from_currency, target)
```

- Для `exchange` tx tied to goal: delta типично отрицательная (spread
  loss). Например 100k RUB (in EUR: 1210) → 1212 USDT (in EUR: 1045),
  delta = 1045 − 1210 = −165 EUR.
- Для `transfer` (same currency): delta = 0 (no spread).
- Для exit (in/out currency different + один из них == target_currency):
  delta = net flow в target.

### Что НЕ меняется

- `incomes.goal_id` (Stage 7) — без изменений.
- `goal_contributions` — без изменений.
- `snapshots` (включая auto_transaction) — балансы вёдер живут
  независимо от goal-tagging.

## 6. API contract

Все endpoints под `requireAdminSession`.

### `POST /v1/web/transactions`
- Body: добавлено nullable `goal_id`.
- Validation: если задан → goal must exist (`deleted_at IS NULL`).
- Response: без изменений; `goal_id` echo'ит в payload (через GET).

### `POST /v1/web/chains`
- Body: добавлено top-level nullable `goal_id`. Если задан → каждый
  step.goal_id = chain.goal_id (backend propagation). Steps НЕ могут
  иметь свой goal_id (mixed disallowed).
- Validation: если задан → goal must exist.
- Response: без изменений.

### `GET /v1/web/goals/:id`
- Response расширен:
  ```json
  {
    "goal": { ...same... },
    "contributions": [
      { "source": "income", ... },
      { "source": "manual", ... },
      {
        "source": "exchange" | "transfer",
        "transaction_id": "uuid",
        "date": "...",
        "from_amount": ..., "from_currency": "RUB",
        "to_amount": ..., "to_currency": "USDT",
        "delta_in_target": -165.21,    // spread loss
        "chain_id": "..." | null,
        "chain_sequence": null,
        "note": "..."
      }
    ]
  }
  ```

### `GET /v1/web/goals` (list)
- В каждом goal: `balance` теперь включает transaction deltas.

### `POST /v1/web/transactions/:id/chain-from`
**Новый endpoint** для workflow «Продолжить цепочку».

- Body:
  ```json
  {
    "next_step": {
      "type": "exchange",
      "to_account_id": "eur-bank",
      "to_amount": 1042.78,
      "fee_amount": null, "fee_currency": null
    },
    "date": "2026-05-25",                // optional, default = today
    "note": "..."                         // optional
  }
  ```
- Behaviour:
  - Если existing tx не в chain: создаётся новый `chain_id`,
    existing tx обновляется (UPDATE tx SET chain_id = ?, chain_sequence = 1).
  - Если уже в chain: добавляется new step с `chain_sequence = max+1`,
    inherit'ит `chain_id`.
  - `from_account_id` = existing.to_account_id; `from_amount` =
    existing.to_amount (наследуется).
  - Auto-snapshots для нового звена создаются как обычно.
  - Backend атомарно через `env.DB.batch`.
- Response:
  ```json
  { "ok": true, "chain_id": "...", "new_tx_id": "...", "snapshot_ids": [...] }
  ```

## 7. UI / UX

### GoalSelector компонент

```
src/components/GoalSelector.tsx — выносим из IncomesPage:
  - useGoals("all") — показываем active+achieved+archived в группах.
  - prop value/onChange.
  - placeholder «— не привязано —».
```

Используется в:
- IncomesPage IncomeModal (existing).
- TransactionsPage ExchangeModal / TransferModal / ChainModal.

### ExchangeModal / TransferModal

```
... existing fields ...

Цель (опц.)
[— не привязано —          ▼]
  🏠 Стартовый депозит
  ✈️ Отпуск 2026
  ...
```

Поле в конце, после «Заметка». Optional.

### ChainModal

```
Дата: [...]

Цель (опц.)
[🏠 Стартовый депозит      ▼]    ← одно поле на всю цепочку

Звено 1
...
Звено 2
...
```

При создании chain — `goal_id` пробрасывается во все steps.

### TxRow «Продолжить цепочку»

В `/transactions` таблице на каждом TxRow между Pencil/Trash добавить:
```
<button title="Продолжить цепочку" onClick={...}>
  <Link2 className="h-4 w-4" />
</button>
```

Клик → открывает `ChainContinueModal` (специальная версия ChainModal):
- Header: «Продолжить цепочку из обмена 25.05»
- Звено 1 (read-only): existing tx — RUB·банк → USDT, 100k → 1212.
- Звено 2 (empty, editable): from auto-filled, to пустое.
- Goal selector inheriting goal_id existing.
- Submit → POST `/v1/web/transactions/:id/chain-from`.

### GoalDetailPage timeline

Добавить tx-source rows в существующий timeline:

```
History:
┌─────────────────────────────────────────────────────────────────┐
│15.05 │💼 Зарплата (income)   │ +100 000 RUB │ → +1210 EUR     │
│25.05 │⇄ обмен (RUB→USDT)     │ −100 000 RUB │ → −165 EUR spread│
│      │                       │ +1 212 USDT  │                  │
│25.05 │🔗 Цепочка abc         │              │                  │
│      │   1. обмен (USDT→EUR) │ −1 212 USDT  │ → +0 EUR (no loss)│
│      │                       │ +1 042 EUR   │                  │
└─────────────────────────────────────────────────────────────────┘
```

- Колонка «Impact on goal» = `delta_in_target` (с знаком).
- Group chain steps под общей строкой 🔗.

## 8. Security

- **Auth.** Все endpoints за Bearer JWT.
- **goal_id validation.** При create tx/chain — FK lookup в goals,
  `deleted_at IS NULL`.
- **Mixed-goal chain prevention.** Backend rejects если steps[i].goal_id
  отличается (или специально не разрешаем поле на step level — только
  top-level chain.goal_id).
- **chain-from endpoint** — проверяет `transaction_id` существует, не
  soft-deleted; user authorized; max chain length (10) не превышен.

## 9. Acceptance criteria

- [ ] AC1: POST `/v1/web/transactions` принимает `goal_id`; tx
  создаётся, GET возвращает её с goal_id.
- [ ] AC2: POST с unknown `goal_id` → 400.
- [ ] AC3: POST `/v1/web/chains` с `goal_id` пробрасывает на все steps.
- [ ] AC4: GET `/v1/web/goals/:id` возвращает unified timeline
  (income + manual + exchange + transfer rows).
- [ ] AC5: `goal.balance` пересчитывает с учётом transaction delta:
  income 100k RUB + exchange 100k RUB→USDT 1212.12 → balance ≈ 1045 EUR
  (вместо 1210 EUR без adjustment).
- [ ] AC6: POST `/v1/web/transactions/:id/chain-from` создаёт chain
  из existing tx + new step. Если existing уже в chain — добавляет
  next step.
- [ ] AC7: chain-from inherit'ит goal_id existing tx, если был.
- [ ] AC8: Admin SPA: goal selector в ExchangeModal / TransferModal /
  ChainModal.
- [ ] AC9: TxRow имеет «Продолжить цепочку» кнопку.
- [ ] AC10: GoalDetailPage timeline показывает tx rows с delta_in_target.
- [ ] AC11: GoalSelector reusable component — используется в incomes +
  transactions.
- [ ] AC12: Регрессии Stages 6/7/7.5 не сломаны.

## 10. Test plan

### Worker curl
- POST tx с goal_id happy → 200.
- POST tx с unknown goal_id → 400.
- POST chain с goal_id → проверить что все steps.goal_id = chain.goal_id.
- GET goals — balance включает tx deltas.
- POST chain-from from existing single tx → chain_id создан, existing tx обновлена.
- POST chain-from from existing chain → next step добавлен.

### Admin Playwright
- /transactions: open «Обмен» — есть «Цель» поле.
- /goals/:id: timeline содержит tx rows.

### Mini App regression
- Запустить трату → ничего не сломано.

## 11. Risks & open questions

- R1: **Edit transactions отсутствует** (Stage 8). Если пользователь
  ошибся в goal_id — не может поправить. Mitigation: можно через
  wrangler SQL UPDATE manually. После Stage 8 (edit) — нормально.
- R2: **Spread loss meaning** — пользователь может удивиться
  отрицательной delta. Tooltip / pill `−165 EUR (spread loss)` в UI.
- R3: **Existing tx 100k RUB → USDT у пользователя** была без goal_id.
  Нужен data fix: `UPDATE transactions SET goal_id = '5cf86d7d-...'
  WHERE id = ?` (через wrangler). Доделаем после deploy.
- OQ1: **Withdraw из goal** через transaction (вывод денег для покупки
  квартиры). Сейчас можно: создать exchange с goal_id=null but
  from_account = ведро, где лежат goal-tied деньги — это «деньги
  ушли». Goal balance не уменьшается, потому что transaction не tied.
  Это странно. Решение: NG1 — отложено в Stage 8 с явным `type='withdraw_goal'`.
- OQ2: **Chain-from на tx уже в chain** — добавление нового tail step.
  Корректно? Да: chain может расти.

## 12. Out of scope для review

- Edit transactions / migrations existing data.
- Withdraw из goal как type.
- Mini App.
- Currency drift correction (historical rates).

## 13. Changelog spec'а

- 2026-05-25: создан. Discovery: уровень 1+2+3 user'а одной итерацией.
- 2026-05-25: `in_progress` (старт Phase 2).
- 2026-05-25: реализованы все уровни одной sprint'ой:
  - Worker: `goal_id` в validateStep + propagation в chain, balance
    includes tx delta в `listGoals` и `getGoalDetail`,
    новый endpoint `POST /v1/web/transactions/:id/chain-from`.
  - Admin: shared `<GoalSelector>` в `src/components/`, integration в
    Exchange/Transfer/Chain modals и IncomeModal (refactor existing).
    Goal-detail timeline теперь показывает tx-rows с delta in target
    currency (spread loss явно подсвечивается красным).
    `ChainContinueModal` workflow на TxRow в `/transactions`.
- 2026-05-25: статус `done`. Audit отложен — критические инварианты
  (atomic chain, FK, spread math) проверены manually через tsc.
