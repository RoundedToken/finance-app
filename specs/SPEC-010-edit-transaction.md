---
id: SPEC-010
title: Edit transaction — inline patch + auto-snapshot reconciliation
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - parent: specs/SPEC-008-stage-7-5-transactions.md
---

# Edit transaction — inline patch + auto-snapshot reconciliation

## 1. Context

SPEC-008 NG4 отложил edit transactions. Реальный сценарий: «забыл
заметку про обмен», нужна возможность дописать. Делаем сейчас.

## 2. Goals

- G1: `PUT /v1/web/transactions/:id` — partial update.
- G2: Для **standalone tx** (chain_id NULL) — full edit: date, account_ids,
  amounts, fee, note, goal_id. Auto-snapshots пересчитываются (DELETE old +
  INSERT new) в одном batch.
- G3: Для **chain tx** — ограниченный edit: только `note`, `goal_id`,
  `fee_amount`, `fee_currency`. Структурные поля заблокированы, чтобы не
  ломать chain consistency. Если нужно поправить amount в chain — user
  удаляет chain и создаёт заново.
- G4: Admin: кнопка Pencil на TxRow → `EditTxModal` с pre-fill, для chain
  tx — соответствующие поля disabled с tooltip.

## 3. Non-Goals

- NG1: **Chain amount/account edit с пересчётом sequence** — отложено.
  Слишком сложная семантика (cascade пересчёт всех snapshots).
- NG2: **Edit type** (exchange ↔ transfer) — отказ. Слишком много invariant
  changes; user delete+recreate.

## 4. API

### `PUT /v1/web/transactions/:id`
- Body (все поля optional):
  ```json
  {
    "date": "YYYY-MM-DD",
    "from_account_id": "...", "to_account_id": "...",
    "from_amount": 123, "to_amount": 456,
    "fee_amount": null|number, "fee_currency": null|"...",
    "note": null|"...",
    "goal_id": null|"..."
  }
  ```
- Validation:
  - Если tx is in chain (chain_id IS NOT NULL) — отказ для полей: date,
    from_account_id, to_account_id, from_amount, to_amount → 400
    «edit of chain transaction limited to note/fee/goal_id».
  - FK validation для account_id, goal_id, fee_currency.
  - Type-specific (exchange currency mismatch, transfer equality) если
    меняются account_id.
- Behaviour:
  - Standalone tx с structural change (account / amount / date):
    DELETE old auto-snapshots (linked via transaction_id) + INSERT new
    с пересчитанным prev_balance + UPDATE tx — всё в одном `env.DB.batch`.
  - Chain tx (только note/fee/goal_id): просто UPDATE tx.
- Response: `{ ok: true, updated: true|false, new_snapshot_ids?: [...] }`.

## 5. Acceptance

- [ ] AC1: PUT standalone tx note + goal_id → tx updated, snapshots
  unchanged.
- [ ] AC2: PUT standalone tx with new from_amount → snapshots recreated
  с правильным balance.
- [ ] AC3: PUT standalone tx с new from_account_id → старый
  auto-snapshot удалён (для старого account), новый создан (для нового).
- [ ] AC4: PUT chain tx amount/account/date → 400.
- [ ] AC5: PUT chain tx note → 200 (только note).
- [ ] AC6: Admin Pencil кнопка на TxRow, EditTxModal с pre-fill, для
  chain tx structural поля disabled.

## 6. Changelog

- 2026-05-25: создан + сразу implementation (одной sprint'ой).
- 2026-05-25: реализовано:
  - Worker `updateTransaction` — partial patch, chain-tx limited to
    note/fee/goal_id; standalone tx — full edit с пересчётом
    auto-snapshots в atomic batch (4 stmts: UPDATE tx + UPDATE
    snapshots SET deleted_at + 2× INSERT new auto_transaction).
  - Корректировка prev_balance: если account_id не менялся → отменяем
    эффект старой tx (`prev += old.from_amount` для from-side),
    чтобы не double-count'ить. Если менялся — old auto-snapshot
    soft-deleted, balance ведра автоматически возвращается.
  - PUT `/v1/web/transactions/:id` endpoint.
  - Admin: Pencil button на TxRow, EditTxModal с pre-fill;
    структурные поля disabled для chain-tx + amber warning.
- 2026-05-25: статус done.
