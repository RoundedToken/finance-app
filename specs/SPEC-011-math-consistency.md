---
id: SPEC-011
title: Math consistency — manual snapshots + events as effective balance
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - revised_by: SPEC-025  # AC5 goal balance: MtM → поток
  - parent: specs/SPEC-005-stage-5a-snapshots-crud.md
  - parent: specs/SPEC-008-stage-7-5-transactions.md
---

# Math consistency — manual snapshots + events as effective balance

## 1. Context

Текущая модель: auto-snapshots генерируются при каждой transaction
(`prev_balance ± delta`) и являются source of truth для bucket balance.
Это даёт сбойную математику:

- Без manual snapshot перед обменом RUB→USDT: `prev=0`,
  auto-snapshot `-100 000 RUB`. Net worth уходит в минус.
- Goal balance считается через **другой алгоритм** (income converted +
  tx delta), результаты двух систем расходятся.
- Manual snapshot и auto-snapshot живут в одной таблице и не различимы
  для UI / расчёта.

Пользователь поймал баг и попросил «строго прописать математику».

## 2. New model

```
effective_balance(bucket, asOf?) =
    base_balance(bucket, asOf)          ← manual ground truth
  + Σ events(bucket, after base, until asOf)
```

Где:
- **`base_balance`** = `amount` последнего manual snapshot для bucket'a
  с `date ≤ asOf`. Если manual snapshot отсутствует → `0`.
- **Events** = incomes (`+amount`), expenses (`−amount`),
  transactions (`+to_amount` если bucket=to_account, `−from_amount` если
  bucket=from_account), goal_contributions (`+amount` если задан
  account_id, иначе invisible для bucket'а), все после `base_date`.

Все суммы в **native currency** ведра (без конверсии). `effective_balance`
читается on-demand, не хранится.

## 3. Goals

- G1: Auto-snapshots полностью убираются. Worker `createTransaction`,
  `createChain`, `chainFromTransaction`, `updateTransaction` больше
  **не пишут** snapshots. Только `tx`-таблица.
- G2: `snapshots.source` теперь имеет фактически одно значение —
  `'manual'`. Колонка `transaction_id` остаётся, но всегда NULL для
  новых записей. Существующие auto-rows вычищаются (см. §7 migration).
- G3: Новый `getEffectiveBalance(env, accountId, asOfDate?)` в
  `snapshots.ts` — вычисляет balance per spec выше.
- G4: `latestSnapshotPerAccount` → переименован `manualBalancePerAccount`,
  возвращает `{accountId: {amount, asOfDate, source}}` для manual snap.
- G5: `/v1/web/accounts` → возвращает per-bucket:
  ```json
  {
    "id": "rub-bank",
    ...,
    "manual_snapshot": null | { id, date, amount },
    "effective_balance": 387320.12,   // в native currency
    "events_summary": { incomes: N, expenses: N, transactions: N }
  }
  ```
  Net worth = Σ `effective_balance(bucket) / rate(bucket.currency → EUR)`.
- G6: Overdraft validation на события, уменьшающие bucket (уточнено Стадией 2 §L1):
  - **Transactions** (from-side): блок, если `effective_balance(from) < from_amount`
    — даже без baseline (balance от 0). Create + edit (с откатом старых сумм).
  - **Expenses** (create): блок, если `effective_balance < amount`, **но только при
    наличии manual baseline ≤ даты И выбранного `account_id`**. Без baseline или без
    выбранного ведра не блокируем (иначе Mini App без снапшота / без счёта был бы
    нерабочим — см. NG3). На практике покрывает Mini App с выбранным ведром; бот не
    задаёт `account_id` → его траты не проверяются. Сообщение — `400 {error}` /
    `⚠️` в боте / toast в Mini App.
  - Income / goal-contribution — это приходы (+), overdraft к ним не применяется.
- G9 (Стадия 2 §L3): **семантика snapshot = «конец дня»**. События учитываются
  строго `date > baseline.date` (операции дня снапшота уже отражены в нём). Чтобы
  скорректировать день снапшота — поставь дату следующего дня или новый снапшот.
  Формула едина в `getEffectiveBalance` и `dashboard.balanceAt` (`ledger.reconstructBalance`).
- G10 (Стадия 2 §L2): **комиссия транзакции (`fee_amount`)** вычитается из ведра-
  плательщика (валюта = `fee_currency`, приоритет `from_account`). Комиссия в третьей
  валюте (≠ from/to) не атрибутируется (редко). См. `ledger.feePayerBucket`.
- G11 (Стадия 2 §L4): **goal_contribution.account_id обязателен** — каждый взнос лежит
  в реальном ведре, иначе `targeted` раздувается без покрытия в `net` (инвариант
  `free = net − targeted`). `income.goal_id` и взнос на одни деньги — взаимоисключающие.
- G7: Admin SPA:
  - **`/accounts` bucket card**: показывает `effective_balance` крупно.
    Если есть manual snapshot — небольшая подпись «manual: X от dd.mm»
    и drift (`effective − manual`). Если manual нет — подсказка
    «Внеси текущий баланс из банковской выписки» (link на /snapshots).
  - **`/snapshots`**: показывает только manual (source='manual') по
    умолчанию. Auto-rows нет, потому что их нет в БД больше.
  - **Transaction create modals**: на submit — если effective_balance
    from_bucket недостаточен, server вернёт 400 → красный alert в UI
    с конкретной суммой.
- G8: Goal balance тоже использует `effective_balance` semantics:
  income/contribution converted + tx delta — это **уже** event-based,
  не trogal auto-snapshots. **Никаких изменений в goal balance**
  логике — она и так была правильной.

## 4. Non-Goals

- NG1: **Drift correction** (когда manual после events расходится с
  computed) — пока просто visualize, не разрешать конфликт автоматом.
  Manual override = next baseline.
- NG2: **Historical rate per event** (currency drift) — отложено
  Stage 7.5.0.
- NG3: **expense.account_id обязателен** — для legacy 1822 expenses
  оставляем как есть (`acc_money_ok_rsd` уже на них). Новые expense
  через Admin SPA не создаём (Mini App работает).
- NG4: **Mini App** — без изменений.
- NG5: **Edit chain transaction structural fields** — остаётся
  заблокировано (SPEC-010 NG).

## 5. API

### `GET /v1/web/accounts` (изменён)
```json
{
  "accounts": [
    {
      "id": "rub-bank",
      "name": "RUB · банк",
      "currency": "RUB",
      "form": "digital",
      "manual_snapshot": null | {
        "id": "uuid", "date": "2026-05-20", "amount": 500000
      },
      "effective_balance": 400000.0,
      "events_count": 3
    },
    ...
  ]
}
```
Auto-snapshots не показываются. `latest_snapshot` поле — удаляется.

### Snapshots endpoints — без изменений семантически
- POST/PUT/DELETE по-прежнему оперируют snapshot rows с
  `source='manual'`. Новые автоматические rows не создаются.

### Transaction / income / expense / goal-contribution endpoints
- На write — Worker сначала вычисляет effective_balance(from_bucket).
  Если уменьшение делает balance < 0 — 400 с message.
- Никаких snapshot mutations.

## 6. Acceptance

- [ ] AC1: Существующий обмен 100k RUB → 1400 USDT остаётся, но
  auto-snapshots удалены. `/accounts` для RUB·банка показывает
  `effective_balance = -100 000` (потому что нет manual baseline).
- [ ] AC2: Создание snapshot RUB·банка на 500 000 → `effective_balance`
  RUB·банка становится `500 000 − 100 000 = 400 000`.
- [ ] AC3: Попытка обмена 600 000 RUB → 400 «недостаточно средств в
  RUB·банк».
- [ ] AC4: Net worth = sum effective converted to EUR. Если нет manual
  baseline — balance отрицательный, но это явное состояние с
  предупреждением.
- [ ] AC5: Goal balance не меняется (та же логика).
- [ ] AC6: SnapshotsPage показывает только manual snapshots.

## 7. Migration

Single-user, data в основном тестовая:
```sql
-- 0010_drop_auto_snapshots.sql
DELETE FROM snapshots WHERE source = 'auto_transaction';
-- Колонка transaction_id остаётся (теоретически может пригодиться).
-- Source enum сохраняется ('manual' | 'auto_transaction'); новые insert'ы
-- ВСЕГДА 'manual'.
```

После apply — все балансы пересчитаются автоматически (effective
computed on read).

## 8. Changelog

- 2026-05-25: создан, реализация одной sprint'ой.
- 2026-07-07: обратный superseded-маркер (аудит 2026-07, SPC-08): AC5 (goal balance mark-to-market) пересмотрен SPEC-025/ADR-020 — вклад в цель теперь поток, фиксируется по курсу даты вклада; шаг `target_currency → EUR` остаётся MtM. Остальные инварианты (effective_balance, tie-break) актуальны.
