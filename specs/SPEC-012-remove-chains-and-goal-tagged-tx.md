---
id: SPEC-012
title: Remove chains + goal-tagged transactions
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - supersedes: specs/SPEC-008-stage-7-5-transactions.md (частично — chains)
  - supersedes: specs/SPEC-009-stage-7-5-2-goal-tagged-transactions.md (полностью)
---

# Remove chains + goal-tagged transactions

## 1. Context

После реальной попытки использования: фичи **chains** (multi-step
обмены через `chain_id`) и **goal-tagged transactions** (`goal_id` на
exchange/transfer + spread loss в goal balance) оказались UX-шумом.

Конкретный кейс пользователя: «получил 100k от родителей, обменял
половину сейчас по одному курсу, половину через месяц по другому,
ещё подразбил между банками — всё перемешается и aналитика по такой
саге не даёт ничего». Spread loss колонка в goal timeline тоже
информационно бесполезна — это нормальный фрикшен реальной жизни,
а не actionable insight.

Chains — то же: «builder цепочки» делали красивую визуализацию, но
аналитика total PnL цепочки в практике не используется. Та же
информация выводится из обычных transactions без чейнинга.

**Решение**: упростить модель. Transactions остаются для exchange и
transfer (Stage 7.5 base). Никаких chain_id, никаких goal_id на tx.

## 2. Goals

- G1: Goal balance считается только как
  `Σ incomes(in target_currency) + Σ manual goal_contributions`.
  Tx delta больше не входит.
- G2: GoalDetailPage timeline показывает только incomes и manual
  contributions. Заголовок «История пополнений» точен.
- G3: Worker endpoints удалены: `POST /v1/web/chains`,
  `GET /v1/web/chains/:id`, `DELETE /v1/web/chains/:id`,
  `POST /v1/web/transactions/:id/chain-from`. Helpers `createChain`,
  `getChainDetail`, `deleteChain`, `chainFromTransaction` тоже.
- G4: Worker `createTransaction` / `updateTransaction` больше не
  принимают `goal_id`. Соответственно `validateStep` не вызывает
  `validateGoalRef` для tx (incomes по-прежнему могут привязываться
  к goal).
- G5: Admin: удаляются `ChainModal`, `ChainDetailPage`,
  `ChainContinueModal`. Кнопки `+ Цепочка` и `🔗 Продолжить цепочку`
  убираются с `/transactions`. Goal selector убирается из
  Exchange/Transfer/Edit modals.
- G6: Маршрут `/chains/$chainId` удаляется. `useChainDetail`,
  `useCreateChain`, `useDeleteChain`, `useChainFrom` хуки удаляются.
- G7: Колонки `chain_id`, `chain_sequence`, `goal_id` в таблице
  `transactions` **сохраняются** в схеме (без миграции). Это
  «спящие» поля — на случай если фичу вернём позже. Текущие данные
  пользователя (`goal_id = '5cf86d7d...'` на единственной tx)
  вычищаются через wrangler UPDATE (см. §6).

## 3. Non-Goals

- NG1: **Удалять колонки из БД** — не делаем (data preservation, нет
  миграционного риска).
- NG2: **Удалять `incomes.goal_id`** — Goal-tagged incomes
  (Stage 7) остаются. Это и есть основной механизм привязки денег к
  цели.

## 4. Data fix

```sql
-- На production выполнить через wrangler:
UPDATE transactions SET goal_id = NULL WHERE goal_id IS NOT NULL;
UPDATE transactions SET chain_id = NULL, chain_sequence = NULL
  WHERE chain_id IS NOT NULL;
```

## 5. Acceptance

- [ ] AC1: `POST /v1/web/chains*` → 404.
- [ ] AC2: `POST /v1/web/transactions/:id/chain-from` → 404.
- [ ] AC3: POST/PUT `/v1/web/transactions` с `goal_id` в body — поле
  игнорируется (или 400, по выбору; см. §5 решение ниже).
- [ ] AC4: `GET /v1/web/goals/:id` возвращает только incomes + manual
  contributions в timeline.
- [ ] AC5: `goal.balance` пересчитан без tx delta — для существующей
  цели «Ипотека» баланс растёт только за счёт двух incomes 100k RUB
  каждый = ~2 420 EUR (не 2 413 как было).
- [ ] AC6: UI `/transactions` имеет только `+ Обмен`, `+ Перевод`
  (без «Цепочка»). На TxRow только ✏ и 🗑 (без 🔗).
- [ ] AC7: Edit tx modal не имеет поля «Цель».
- [ ] AC8: `/chains/:id` маршрут отсутствует — 404 от router.

## 6. Решение по обратной совместимости в `goal_id` поле

POST/PUT принимает `goal_id` field в payload — backend **игнорирует
тихо** (не возвращает 400). Это устойчивее к старым SPA-сборкам,
которые могут быть в браузерном кеше у пользователя.

## 7. Changelog

- 2026-05-25: SPEC создан + реализация одной sprint'ой.
