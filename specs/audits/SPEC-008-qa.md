# SPEC-008 — QA audit

**Verdict:** PASS_WITH_SHOULDS
**Auditor:** senior-qa subagent
**Date:** 2026-05-25

## Summary

Stage 7.5 (Transactions) реализован близко к спецификации: backend `transactions.ts` корректно валидирует exchange/transfer/chain, считает prev_balance по самой свежей snapshot ≤ `tx.date`, выполняет atomic batch для записи 1 transaction + 2 snapshots и cascade soft-delete'ит auto-snapshots при DELETE tx/chain. SPA-страницы `/transactions` и `/chains/:id` смонтированы в `routeTree.tsx`, sidebar активирован с иконкой `ArrowRightLeft`. Auth (`requireAdminSession`) проставлен на всех 6 endpoints.

Главные дефекты:
- **M1**: `POST /v1/web/chains` НЕ атомарна — `createChain` (transactions.ts:283) делает sequential `await persistTransaction` в цикле, каждое звено batch'ит свои 3 statement'а, но между звеньями нет общей транзакции. Если шаг 2 падает (например, валидация FK или D1 error), шаг 1 уже закоммичен → orphaned chain с одним звеном + двумя snapshots, и `chain_id` уже занят. Spec §8 «Atomic batches» этого не позволяет. **Riskful** для chain с большим N.
- **S1**: AC19 **не реализован**. `AccountsPage.tsx` не подписывается на `useTransactions` и не показывает «N обменов в этом месяце» под bucket card. Нет ни импорта, ни логики подсчёта.
- **S2**: AC9 (warning при `prev=0`) **не отображается в UI**. Backend честно ставит `0 ± delta`, но `AccountsPage` / `TransactionsPage` / `SnapshotsPage` не показывают warning «Баланс начат с обмена — проверьте корректность».
- **S3**: `SnapshotsPage` не различает `source='auto_transaction'` от `manual`. Пользователь увидит auto-snapshot среди обычных и может его отредактировать или удалить, после чего DELETE transaction уже не сможет корректно откатить (видимое — soft-delete уже произошёл; не-видимое — баланс перестал сходиться). `listSnapshots` (snapshots.ts:21) даже не возвращает `source` в SELECT-листе для UI… **wait** — возвращает (line 21). Но UI не использует. Это нарушение спецификации UX-инварианта.
- **S4**: Прочие issues (dead imports, deep validation edge cases, отсутствие подписи source в UI snapshots).

Остальные AC §9 и edge cases E1-E10 — pass.

## Must-fix (M)

- **M1. Chain create не атомарна между звеньями.** `transactions.ts:283` цикл `for` поверх `persistTransaction`, каждое — отдельный `env.DB.batch`. Если step 2 падает (например, `validateStep` за пределами Worker uncaught throw, либо CHECK constraint), step 1 уже записан → возникает «частичная цепочка» с consistent `chain_id`, но без полного path. Spec §8 явно требует «Для chain — batch с 2N + N inserts» (атомарно). Решение: собирать **все** prepared statements в один `env.DB.batch([...всех 3N stmts])` либо использовать `INSERT OR IGNORE` + post-check rollback. Сейчас это нарушение SPEC §8 и AC11 implicit guarantee.
  - **Воспроизведение**: подать chain payload где `steps[0]` валиден, а `steps[1].from_account_id` =`steps[0].to_account_id` (правильно), но `steps[1].to_account_id` ссылается на soft-deleted account. Backend пропустит pre-validation (loadAccount проверяет `deleted_at IS NULL`), но… на самом деле validateStep уже отфильтрует, ок. Лучший вектор: D1 transient error / quota во второй итерации.
  - Severity: **M** (а не S), потому что нарушается контракт «всё-или-ничего» из spec §8, и риск частичных записей на проде не нулевой при росте latency или конкурентных операциях.

## Should-fix (S)

- **S1. AC19 не реализован: AccountsPage не показывает «N обменов в этом месяце».**
  `AccountsPage.tsx` импортирует только `useAccounts`/`useGoals`/`useReferences`. Нет `useTransactions`. `BucketCard` (line 105–158) показывает date снапшота, но не количество обменов. SPEC §7.G9 + AC19 чётко требуют subtitle.
  Решение: подключить `useTransactions`, в `BucketCard` посчитать `txs.filter(t => (t.from_account_id === acc.id || t.to_account_id === acc.id) && t.date >= startOfMonth).length` и рендерить под балансом.

- **S2. AC9 warning «Баланс начат с обмена» отсутствует.**
  Backend `latestSnapshotAmount` (transactions.ts:52) возвращает 0 при отсутствии предыдущего снапшота, и `persistTransaction` создаёт snapshot со значением `0 ± delta`. **UI про это никак не сигналит**. Spec §4 E1: «UI показывает warning на карточке bucket'а: "Баланс начат с обмена — проверьте корректность"». Сейчас warning не реализован ни в `AccountsPage`, ни в `TransactionsPage`. Невыполнение AC9 как такового — backend гарантию даёт, но spec обязывает и UI индикатор. Решение: на бэке вернуть в `POST /v1/web/transactions` response `first_snapshot_for_from`/`first_snapshot_for_to` boolean'ы, либо вычислять на фронте по списку snapshots.

- **S3. SnapshotsPage не помечает auto_transaction snapshots, разрешает их edit/delete.**
  `SnapshotsPage.tsx:108-146` рендерит row для каждого snapshot, кнопки `Pencil` + `Trash2` всегда активны. Auto-snapshot имеет `source='auto_transaction'`, и его ручной edit / delete ломает инвариант: 
  - DELETE auto-snapshot мимо transaction → `transaction.deleted_at IS NULL`, но snapshot уже soft-deleted, balance computation некорректен.
  - PUT auto-snapshot.amount → balance уплывёт от того, что обещает transaction.
  Решение: либо скрывать auto-snapshots из SnapshotsPage (фильтр по source), либо рендерить «локированные» с badge «Авто, из обмена …», disabled buttons + click открывает transaction detail. Также backend должен отказать на DELETE/PUT snapshot если `source = 'auto_transaction'` (server-side guard). См. ADR-013 inv.

- **S4. `listSnapshots` не возвращает `transaction_id` SELECT-полем.**
  `snapshots.ts:21` SELECT'ит: `id, date, account_id, amount, note, source, created_at, updated_at` — без `transaction_id`. Тип `Snapshot` (`types.ts:42-50`) тоже без `transaction_id`. UI не может ассоциировать snapshot ↔ transaction, что необходимо для S3.

- **S5. Dead imports в TransactionsPage.tsx.**
  `cn` (line 16) и `useReferences` (line 9) импортированы, но не используются. Артефакт промежуточных версий. Безвредно, но dead code.

- **S6. Транзакция тип `type` не валидируется в createChain для каждого step.**
  В `validateStep` (line 67) проверка корректна, но при отправке chain клиент шлёт `type` для каждого step. Если клиент отправит `type: "transfer"` для шага с разными валютами — `validateStep` отдаст 400 «transfer requires from.currency === to.currency». OK. Но **в `ChainModal` (TransactionsPage.tsx:418-572) пользователь не выбирает type для шага**: все steps хардкодом `type: "exchange"` (line 429-430). Если в цепочке есть шаг RUB→RUB (transfer), пользователь не сможет его создать через UI — backend отдаст 400 «exchange requires from.currency !== to.currency». Минорно: реальные цепочки практически всегда exchange-only.

- **S7. ChainDetailPage: `data.transactions[0]?.date` форматируется без отступа.**
  `ChainDetailPage.tsx:85-86`: `{data.step_count} {plural} ·{data.transactions[0]?.date && ` ${formatDate(...)}`}` — missing space перед `·` или после, в зависимости от рендера. Текстовая косметика.

- **S8. NOT NULL guard на schema.snapshots.note для auto_transaction.**
  Не баг, но `persistTransaction` пишет note вроде `"auto: exchange −100000 RUB"`. После SnapshotsPage edit пользователем — потеряется метка. Нужен либо неизменяемый признак (source field уже есть), либо реализация S3.

- **S9. `cn` импорт в TransactionsPage.** Уже отмечено в S5.

- **S10. Idempotency on POST chains.** `payload.chain_id` если задан клиентом — Worker генерит новый `transactionIds` UUID на каждое звено. Если клиент retry'ит с тем же `chain_id`, при первой попытке записаны 2 tx + 4 snapshots. На retry — `INSERT OR IGNORE INTO transactions` не пишет (potentially), но snapshots уже без OR IGNORE — записывает дублирующиеся snapshots на ту же дату. **transactions.ts:228-235** snapshot INSERT не использует OR IGNORE. Это создаст snapshot duplicates при retry.  
  **Воспроизведение**: дважды отправить POST /v1/web/chains с одинаковым chain_id+steps. Первый — 4 snapshot. Второй — ещё 4 snapshot (orphan от попыток вставки tx, которые OR IGNORE), хотя transaction уже есть. Severity: S (idempotency violation; AC11 говорит «должны быть» — это всё ещё true, но повторный POST создаёт shadow data).

## Nice-to-have (N)

- **N1.** `listTransactions` (transactions.ts:131) сортирует `ORDER BY date DESC, created_at DESC, chain_sequence ASC`. Сочетание `created_at DESC` + `chain_sequence ASC` нелогично: в одной цепочке шаги имеют возрастающий `chain_sequence`, но `created_at` тоже растёт — `created_at DESC` для них перевернёт порядок. Лучше: `ORDER BY date DESC, chain_id NULLS LAST, chain_sequence ASC, created_at DESC`.

- **N2.** `getChainDetail` (transactions.ts:158): если у chain step `from_amount` = 0 (что невозможно из-за CHECK), `effective` падает на /0. Сейчас защищено `last.to_amount && first.from_amount` (любое из 0 → null). Но если `first.from_amount > 0 && last.to_amount > 0` always (DB CHECK), check бесполезен. Документировать.

- **N3.** `ChainDetailPage.tsx:85` plural rule: «{step_count === 1 ? "шаг" : data.step_count < 5 ? "шага" : "шагов"}» — некорректен для 21 (нужен «шаг»), 22-24 («шага»). См. `pluralizeGoals` в AccountsPage для правильного russian plural.

- **N4.** Modal'ы не имеют `aria-labelledby` — Modal сам имеет `role="dialog" aria-modal="true"`, но не привязывает к title. Screenreaders произнесут «диалог» без названия.

- **N5.** В Modal'ах `ChainModal`/`ExchangeModal`/`TransferModal` нет fokus-trap. При Tab из последнего инпута фокус уходит в фон. Modal.tsx не имеет focus trap (только Escape close).

- **N6.** В TxRow rate text формируется через `formatExchangeRate(...) ?? "—"`. OK. Но в ChainModal effectiveText используется без fallback — если first/last не определены, ничего не отображается, но компонент не показывает «—» (UX gap).

- **N7.** SPA invalidations: `invalidateOnTxMutation` (queries.ts:310) инвалидирует `transactions`/`snapshots`/`accounts`. Не инвалидирует `goals` — если goal_id ever заполнен (когда Stage 8 наступит), balance не обновится. Зарезервировано для будущего, но note.

- **N8.** `TransactionsPage` ищет в `String(r.from_amount).includes(q)` — конвертация в строку использует JS Number.toString, что выдаёт "1212.12" без локали. Пользователь ищет «100 000» — не найдёт. Косметика поиска.

- **N9.** `useDeleteTransaction` / `useDeleteChain` используют `window.confirm` (TransactionsPage.tsx:154, ChainDetailPage.tsx:28). UX downgrade для destructive — лучше typed confirmation modal. (Same as Stage 7 issue.)

- **N10.** ChainModal не показывает live rate ПЕР звено (только итоговый). SPEC §7 mock показывает «Курс: 1 USDT = 82.50 RUB» под каждым звеном.

- **N11.** TransactionsPage.tsx не имеет `isError`/`error` state для `useTransactions()`. При 500 — пользователь видит «Загрузка…» вечно.

- **N12.** `latestSnapshotAmount` ORDER BY `date DESC, created_at DESC` — `created_at` — TEXT поле с `datetime('now')` формат `YYYY-MM-DD HH:MM:SS`. Lexicographic sort работает для ISO. OK. Но при retroactive tx, где `date < latest snapshot` for that account, prev_balance берётся из последнего snapshot ≤ tx.date — это **не** последний фактический balance. Если на 2026-05-20 был snapshot 1000 EUR, а в 2026-05-25 — snapshot 1500 EUR, и пользователь вводит retroactive tx на 2026-05-22 (амт 100 EUR), prev_from = 1000 (с 2026-05-20), а на 25.05 уже 1500 — auto-snapshot вставит 1000-100=900 на 2026-05-22, но **не пересчитывает 25.05**. Это документировано в NG8 / R1. AC ok, но edge case E8 «short-term inconsistency» — реализация согласована со spec.

## Acceptance criteria

| AC | Status | Note |
|----|--------|------|
| AC1 | PASS | `migrations/0009_transactions.sql` создаёт таблицу + индексы + ALTER snapshots ADD COLUMN. `schema.sql:96-121` синхронизирован. |
| AC2 | PASS | `createTransaction` → `persistTransaction` (transactions.ts:201-238) выполняет `env.DB.batch([tx, fromSnap, toSnap])`. Response `{ ok: true, id, inserted, snapshot_ids: [fromSnapId, toSnapId] }` (index.ts:478). |
| AC3 | PASS | `validateStep` (transactions.ts:73-75): `if (step.from_account_id === step.to_account_id) return 400`. |
| AC4 | PASS | `validateStep` (line 86-88): exchange с одинаковой валютой → 400. |
| AC5 | PASS | `validateStep` (line 89-91): transfer с разными валютами → 400. |
| AC6 | PASS | `validateStep` (line 76-81): `from_amount <= 0` → 400; `to_amount <= 0` → 400. Также SQL CHECK `from_amount > 0`. |
| AC7 | PASS | `persistTransaction` (line 195-198): `prevFrom = latestSnapshotAmount(from.id, payload.date)`, `newFromBalance = prevFrom - payload.from_amount`. Snapshot вставляется с `date = payload.date`. |
| AC8 | PASS | Аналогично, `newToBalance = prevTo + payload.to_amount`. |
| AC9 | PARTIAL | Backend честно ставит 0 при отсутствии (line 60: `r?.amount ?? 0`). **UI warning «Баланс начат с обмена» отсутствует**. См. Should-fix S2. |
| AC10 | PASS | `handleWebTransactionsList` (index.ts:456-469) и `listTransactions` (transactions.ts:105-135) поддерживают from/to/type/account_id/chain_id. |
| AC11 | PASS (с M1) | `createChain` создаёт N transactions с `chain_id` и `chain_sequence=1..N` + 2N snapshots. **WARN**: не атомарно между шагами — см. Must-fix M1. |
| AC12 | PASS | `createChain` (line 251-253): `steps.length < 2` → 400 «chain requires at least 2 steps». |
| AC13 | PASS | `createChain` (line 271-275): проверка `steps[i].to_account_id === steps[i+1].from_account_id`, при нарушении → 400 «chain inconsistency between steps i+1 and i+2: to/from must match». |
| AC14 | PASS | `getChainDetail` (transactions.ts:137-169) возвращает chain + initial + final + effective_rate + step_count. `handleWebChainsDetail` (index.ts:498-504) проставляет 404 если null. |
| AC15 | PASS | `deleteTransaction` (line 297-311): batch UPDATE transaction `deleted_at` + UPDATE snapshots WHERE `transaction_id=? AND source='auto_transaction' AND deleted_at IS NULL`. |
| AC16 | PASS | `deleteChain` (line 313-335): batch UPDATE всех tx по `chain_id` + связанных snapshots. **Note**: пред-SELECT для ids (line 314), затем batch — два round-trip, не атомарный «one batch», но snapshot UPDATE использует `transaction_id IN (...)` корректно. |
| AC17 | PASS | `TransactionsPage.tsx` рендерит h1 «Обмены», кнопки `+ Обмен / + Перевод / + Цепочка` (line 68-78), PeriodPicker, фильтры тип/ведро/поиск. Sidebar Обмены в `AppLayout.tsx:21` с `ArrowRightLeft`. Active state через `useRouterState` + `startsWith` (line 31). |
| AC18 | PASS | `ChainDetailPage.tsx` рендерит чейн detail с initial/final/effective_rate. |
| AC19 | FAIL | `AccountsPage.tsx` не имеет `useTransactions`, не показывает «N обменов в этом месяце». См. Should-fix S1. |
| AC20 | PASS | `/expenses`, `/incomes`, `/snapshots`, `/goals` — routes не тронуты в routeTree.tsx. Worker handlers `handleWebExpenses`/`handleWebIncomes*`/`handleWebSnapshots*`/`handleWebGoals*` остались. ALTER TABLE snapshots ADD COLUMN nullable — backward compat ok. |

**Итого AC §9: 18/20 PASS, 1 PARTIAL (AC9), 1 FAIL (AC19).**

## Edge cases

| E# | Status | Note |
|----|--------|------|
| E1 | PARTIAL | Backend prev=0 ставит, UI warning отсутствует (см. S2). |
| E2 | PASS | `validateStep` (line 73): from == to → 400. |
| E3 | PASS | `validateStep` (line 76, 79): amount ≤ 0 → 400. SQL CHECK + bind throws. |
| E4 | PASS | `validateStep` (line 89-91): transfer с разными валютами → 400. UI TransferModal фильтрует to-list по same currency (TransactionsPage.tsx:338). |
| E5 | PASS | `createChain` (line 251): `steps.length < 2` → 400. UI ChainModal начинает с 2 звеньев, `removeStep` блокирует удаление если ≤2 (line 447-449). |
| E6 | PASS | `createChain` (line 271-275): sequence consistency check; UI ChainModal показывает warning live (TransactionsPage.tsx:532-535). |
| E7 | PASS | Допускается: backend проверяет только `step[i].to_account_id === step[i+1].from_account_id` (не amounts). |
| E8 | PARTIAL | Retroactive tx разрешена; backend честно вставляет snapshot на tx.date. **Short-term inconsistency не флагуется в UI** — известное ограничение (NG8). |
| E9 | PASS | `deleteTransaction` cascades soft-delete только snapshots с `source='auto_transaction' AND transaction_id=tx.id`. Manual-edit snapshots сохраняются. |
| E10 | PASS | Rate computation = `to_amount / from_amount`, не зависит от `rates` таблицы. |

## Регрессии

- **Stage 4 (expenses, dashboard)** — endpoints `/v1/web/expenses` не тронуты. Mini App `/v1/expenses` тоже. PASS.
- **Stage 5 (snapshots)** — `ALTER TABLE snapshots ADD COLUMN transaction_id` (миграция 0009 line 36) — nullable, backward compat. `listSnapshots`/`createSnapshot`/`updateSnapshot`/`deleteSnapshot` не модифицированы. **WARN**: SnapshotsPage не различает auto vs manual — см. S3. Backend `updateSnapshot`/`deleteSnapshot` не имеют guard против изменения auto-snapshots. Это может сломать invariant cascade-rollback.
- **Stage 6 (incomes)** — endpoints не тронуты. Schema не модифицирована.
- **Stage 7 (goals)** — `goal_id` на transactions — nullable, всегда NULL в этой итерации (NG1). `goals` table не тронута. PASS.
- **Mini App** — миграция 0009 не задевает `/v1/expenses`. Mini App ничего не знает о transactions. PASS.
- **AccountsPage** — `useGoals`/`useReferences` сохранены. `Net worth = Свободно + Целевые` остался. Auto-snapshots от transactions через `latest_snapshot_per_account` (snapshots.ts:33-50) включаются автоматически. Источник `auto_transaction` не фильтруется — корректно (balance = последний snapshot по дате, source неважен). PASS.
- **Sidebar** — `/transactions` корректно занимает место «Обмены», ранее disabled (Stage 4/5 заглушка не существовала). Order сохранён: Дашборд / Счета / Снапшоты / Расходы / Доходы / Цели / Обмены (AppLayout.tsx:14-22). PASS.
- **routeTree** — `transactionsRoute` + `chainDetailRoute` под `authedRoute` (line 96-100). beforeLoad проверяет токен → редирект на /login при истечении. PASS.

## Auth (security checklist)

- **JWT requirement** — все 6 handlers (`handleWebTransactionsList/Create/Delete`, `handleWebChainsCreate/Detail/Delete`) первой строкой вызывают `requireAdminSession` (index.ts:456-511). PASS.
- **No-token request** → 401 `{ error: "unauthorized" }` (auth-google.ts:125-128). PASS.
- **Expired JWT** → `verifyJwt` returns `ok: false` → 401, SPA `routeTree.tsx:31-36` редиректит на /login. PASS.
- **Foreign email** → `isAllowedEmail` check (auth-google.ts:130-138) → 403 «forbidden». PASS.
- **Mini App нет доступа** — нет endpoint `/v1/transactions` (только `/v1/web/transactions`). Mini App использует initData, не Bearer. PASS.
- **CORS** — централизованно через `cors.ts`. `ADMIN_ALLOWED_ORIGINS` whitelist для return_to. PASS.
- **Input validation** — type enum, date ISO regex, from/to FK + must differ, amounts > 0, currency derived from accounts (не от клиента), fee_amount ≥ 0 + requires fee_currency. PASS.
- **PII в логах** — `transactions.ts` не логирует поля. `index.ts:178` логирует только `String(err)`. PASS.

## Performance

- **List endpoint** — `idx_transactions_active (date) WHERE deleted_at IS NULL` (migration 0009 line 34) и `idx_transactions_from`/`idx_transactions_to` для account-filter. PASS.
- **List при больших объёмах** — `limit` capped at 20000 (line 116). При N=1000+ — клиент TanStack Query кэширует 30s, sort на бэке indexed. PASS.
- **Chain detail** — 1 query по `chain_id` index (line 31 of migration). PASS.
- **AccountsPage net worth** — не тронут, prev perf характеристики сохранены.
- **persistTransaction** — 1 SELECT latest (idx_snapshots_account_date) + 1 batch[3 inserts]. PASS.
- **deleteChain** — 1 SELECT ids + 1 batch[2 UPDATEs]. Можно объединить, но не bottleneck.

## A11y

- **Modal'ы** — `role="dialog"`, `aria-modal="true"`, Escape-close (Modal.tsx:81-89). PASS базовый minimum.
- **Buttons** — все имеют либо текст («Обмен», «Создать», «Отмена»), либо `aria-label` («Удалить», «Закрыть»). PASS.
- **Tab order** — нативный по DOM, форма стандартная. PASS.
- **Focus indicators** — Tailwind `focus:ring-2 focus:ring-ring` на inputs/Select/buttons. PASS.
- **Color contrast** — `text-destructive` (red-500) на white background ≈ 4.5:1; `text-muted-foreground` (gray-500) близок к границе. Возможна проблема в dark mode для `text-amber-600 dark:text-amber-400` warning'ов. См. N4 (aria-labelledby), N5 (focus trap).
- **Transactions table** — semantic `<table>`, корректные `<th>`. Однако table headers без `scope="col"`. Минорно.
- **ChainDetailPage** — back-link присутствует (line 45-47). PASS.

## Open questions

- **Q1 (Must-fix M1):** Должна ли `createChain` быть полностью атомарной (одна batch с 3N statements) или partial-create приемлем при сетевых сбоях? Spec §8 говорит атомарной. Текущая реализация — eventual consistency. Рекомендую исправить до push (объединить statements в один `env.DB.batch`).
- **Q2 (Should-fix S3):** Обязать backend guard против edit/delete auto-snapshots, или достаточно UI блокировки? Если ADR-013 «безопасные мутации» — guard на бэке обязательная.
- **Q3 (AC19):** Subtitle «N обменов в этом месяце» — критично для UX или nice-to-have? Spec §9 явно требует AC. Реализация тривиальна (filter txs + count), пропущена.
- **Q4 (AC9 / S2):** UI warning при первом snapshot для bucket — как именно показывать? Бэйдж на bucket card? Inline в TransactionsPage success-toast? Spec упоминает «warning на карточке bucket'а», что предполагает AccountsPage.
- **Q5 (Idempotency S10):** Auto-snapshots без `OR IGNORE` — намеренно (каждый запуск создаёт новый snapshot) или ошибка? Если клиент retry'ит с тем же chain_id, появятся duplicate snapshots. Решение: либо генерить detrministic snapshot id из tx.id, либо добавить INSERT OR IGNORE с уникальным constraint.
- **Q6 (Что не покрыто аудитом):** Playwright/UI walkthrough не выполнен (нет `local/scripts/test_ui.py` сценариев для transactions). Curl-smoke против `wrangler dev` не запущен (нет prod-credentials в sandbox). Manual visual review кода — выполнен; live behavior — нет.

---

**Рекомендация**: 
- **M1 — починить до push** (chain атомарность критична для финансовой целостности).
- **S1 (AC19), S2 (AC9 warning), S3 (auto-snapshot lock)** — желательно перед merge (AC §9 не пройдёт полностью без них).
- Остальные S и все N — отдельным fix-PR после.
