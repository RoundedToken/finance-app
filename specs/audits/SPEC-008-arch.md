# SPEC-008 — Architecture audit

**Verdict:** APPROVED_WITH_SHOULDS
**Auditor:** solution-architect subagent
**Date:** 2026-05-25

## Summary

Реализация Stage 7.5 (Transactions) аккуратно покрывает Goals G1-G8: миграция
0009 + schema.sql sync ровно по spec; persistTransaction атомарен (1 INSERT
tx + 2 INSERT snapshots в одном `env.DB.batch`); чистая Worker validation
с ISO date regex / FK lookup / currency-mismatch проверками; Web Admin
получил полный CRUD layer (queries + 2 страницы + sidebar). Архитектурно
работа сделана грамотно. Однако обнаружено несколько **должных** правок:
chain create не атомарен (батчируется per-step, не per-chain — нарушает
SPEC §8 и §11 R2), transfer не валидирует `from_amount === to_amount`,
chain идемпотентность сломана (пере-POST с тем же `chain_id` создаст
дубль-tx), AC19 не реализован, и `docs/data-model.md` остался устаревшим.

## Must-fix

(none — нет блокеров уровня безопасности или нарушения ADR)

## Should-fix

- **[atomicity]** `transactions.ts:283-290` — `createChain` вызывает
  `persistTransaction` sequentially, каждый звено = свой batch из 3
  statements. Если N-й шаг падает после успешного i<N, частичная цепочка
  уже зафиксирована в D1. SPEC §8 явно требует «atomic batches ... 2N+N
  inserts» в одном batch'е, и §11 R2 строит лимит `steps.length<=10` именно
  на основе D1 50-statements-per-batch. Текущая реализация: батч на звено
  → нет true all-or-nothing для chain. Compensating delete не реализован.
  Должно: собрать все `2N+N` statements в один `env.DB.batch` (с
  предварительным вычислением prev_balance из snapshots **в памяти**,
  учитывая что step i+1 видит результат step i).

- **[validation]** `transactions.ts:65-101` — для `type === 'transfer'`
  не проверяется `from_amount === to_amount`. Spec §4 happy-path
  transfer: `from_amount = to_amount`. UI отправляет одинаковые суммы,
  но прямой POST через API позволит drift (например `from=100, to=99`),
  что приведёт к incorrect-by-design auto-snapshots без warning. Добавить
  guard в `validateStep`: для transfer → equality check.

- **[idempotency]** `transactions.ts:277-290` — `createChain` принимает
  опциональный `chain_id` (per SPEC §6), но генерирует **новые** UUID
  для каждой transaction внутри. Повторный POST с тем же `chain_id`
  создаст ещё N transactions с тем же `chain_id` — `(chain_id,
  chain_sequence)` не enforced как UNIQUE constraint, как явно отмечено
  в SPEC §5. Нарушает ADR-005 spirit (UUID + INSERT OR IGNORE для
  idempotency). Должно: либо реквайр client-side step `id` в chain
  payload (как `id?` в TransactionPayload), либо pre-check
  «существует ли уже chain с этим chain_id» с early-return.

- **[completeness]** AC19 — bucket card subtitle «N обменов за месяц»
  не реализован. `AccountsPage.tsx` не использует `useTransactions`,
  нет подсчёта tx за текущий месяц per account. SPEC G9 + §7 явно это
  предписывают. Должно: либо реализовать (+1 query + computed map per
  account), либо downgrade в roadmap «nice-to-have».

- **[docs]** `docs/data-model.md:73-95` — раздел «Transactions» описывает
  старую концептуальную схему до SPEC-008 (`amount_out`/`ccy_out`,
  `from_account` без `_id`, типы `interest`/`income`/`adjustment` —
  которых нет в migration 0009). После применения 0009 документация
  расходится с реальностью. Должно: синхронизировать data-model.md
  с актуальной DDL.

- **[deactivated accounts]** `transactions.ts:45-50` — `loadAccount`
  проверяет только `deleted_at IS NULL`, но не `is_active = 1`.
  Транзакция к неактивному ведру разрешена. SPEC §8 говорит "Input
  validation ... FK + must differ", но активность бакета —
  скорее всего ожидаемая гарантия. Должно: либо `AND is_active = 1`
  (consistent с `listBuckets`), либо явно задокументировать что
  inactive accounts остаются «доступными для записи историчных
  операций».

## Nice-to-have

- **[DRY]** `Result<T>` дублируется в `transactions.ts:37-39` и
  `goals.ts:38-40`. Извлечь в `cloud/worker/src/result.ts` или type-only
  модуль. То же касается FK-helper'ов: `loadAccount` (tx) ≈
  `lookupAccountCurrency` (incomes) ≈ `accountExists` (goals) — 3
  варианта одного запроса с разным shape. Личный масштаб → не блокер,
  но через 1-2 stage станет проблемой.

- **[types]** `listTransactions` и `getChainDetail` возвращают `any[]` /
  `transactions: any[]` (`transactions.ts:115,139`). Worker → Admin
  shape определён в `cloud/admin/src/api/types.ts:238-256`, но
  Worker-side type не существует. Добавить `interface TransactionRow`
  и убрать `any`. Не критично — payload пробрасывается as-is, но
  снимает «безмолвный» drift в будущем.

- **[error handling]** `index.ts:474-478` и далее — handler возвращает
  `400` на любую ошибку validation, но при insert-time D1 CHECK
  violation (например, передадим из тестового POST `from_amount=-1`,
  обойдя client-validation) ответ будет 500 (unhandled throw). Stage
  6-7 в roadmap уже есть пункт «серверная валидация payload'ов через
  zod» — стоит включить tx endpoints.

- **[fee validation]** `validateStep:92-99` — проверяет `fee_amount >= 0`
  и `fee_currency` required when fee_amount set. Но `fee_currency` не
  валидируется на существование в `currencies(code)` (FK enforced
  только при INSERT). Можно добавить symmetry с currency lookup.

- **[chain UI]** `TransactionsPage.tsx:469-470` — chain modal hardcodes
  `step.type = "exchange"`. Если пользователь захочет цепочку
  exchange→transfer→exchange, UI это не позволит. Принимаю как
  intentional simplification, но стоит зафиксировать в spec NG.

- **[note propagation]** `transactions.ts:285` —
  `note: stepPayload.note ?? payload.note ?? null` копирует
  chain-level note в каждое звено. Хорошо для history, но не отличить
  «chain-level» от «step-level» note в future analytics. Сейчас
  acceptable.

- **[bot dependency on chain_id length]** Регекс
  `/^\/v1\/web\/(transactions|chains)\/([0-9a-fA-F-]+)$/` принимает
  любую hex-сырую строку, а не строго UUID v4. С учётом того, что
  chain_id всегда UUID — fine.

## SPEC conformance

- G1 (D1 table + chain_id nullable): ✅ migration 0009 + schema.sql sync.
- G2 (CRUD `/v1/web/transactions` + `/v1/web/chains/:id`): ✅ index.ts:158-167.
- G3 (auto-snapshot обоих ведер, atomic batch): ⚠ atomic для одиночек,
  **не атомарен для chain** — см. should-fix.
- G4 (страница /transactions с фильтрами): ✅ TransactionsPage с
  PeriodPicker + type/account/search filters.
- G5 (3 модала: Обмен/Перевод/Цепочка с computed rate badge): ✅.
- G6 (chain badge с кликом на /chains/:id): ✅ TransactionsPage:175-179.
- G7 (goal_id nullable FK зарезервирован): ✅ schema + migration. NG1 соблюдён.
- G8 (sidebar Обмены): ✅ AppLayout.tsx:21.
- G9 (AccountsPage bucket subtitle): ❌ — см. AC19.
- NG4 (нет edit/PUT): ✅ соблюдён — только POST и DELETE handlers.
- NG8 (retroactive limitation): ⚠ не задокументирован в коде/UI —
  spec упоминает known limitation, но в код / помощь к пользователю не
  попало. Хотя бы comment в `persistTransaction` стоило бы.
- §5 invariant «уникальность (chain_id, chain_sequence) валидируем в
  Worker»: ⚠ не валидируется — chain re-POST создаст коллизию sequence.

## ADR conformance

- **ADR-011** (D1-centric): ✅ нет локального state, все CRUD через
  Worker → D1.
- **ADR-012** (Web Admin JWT): ✅ все 5 handlers идут через
  `requireAdminSession`; Mini App доступа не имеет.
- **ADR-005** (UUID + INSERT OR IGNORE): ✅ для одиночной tx
  (`INSERT OR IGNORE INTO transactions`); ⚠ для chain — см.
  should-fix idempotency.
- **ADR-009** (silent bot): N/A.
- **ADR-013** (spec-driven): ✅ работа сделана по SPEC-008.

## Security checklist

- ✅ Все mutating endpoints под `requireAdminSession`.
- ✅ Input validation: ISO date regex, типы, FK existence, currency mismatch.
- ✅ SQL — параметризованные `.bind(...)` везде. Никакой конкатенации
  с user input (placeholders в `deleteChain` строятся из IDs которые
  только что прочитаны из D1 — safe).
- ✅ Нет secrets в коде.
- ✅ Логи: error pathway не выводит PII (только `console.error("unhandled", err)`).
- ⚠ `index.ts:178` всё ещё `String(err)` в response 500 — известный
  tech-debt из retrospective audits (см. roadmap), не специфично для
  Stage 7.5.
- ✅ CORS через shared `cors.ts`.
- ✅ Transfer-validation (from_currency === to_currency) защищает
  от прямого API-вызова exchange-as-transfer.

## Code quality

- **SRP**: `validateStep` / `persistTransaction` / `createChain` —
  чёткое разделение. ✅
- **DRY**: locally в файле — нет дубликатов. Между файлами — повторение
  Result<T> и FK helpers (см. nice-to-have).
- **YAGNI**: `goal_id` зарезервирован per SPEC G7 — допустимо. Иных
  «впрок» абстракций нет.
- **Naming**: `loadAccount`, `latestSnapshotAmount`, `persistTransaction`,
  `validateStep` — все осмысленны.
- **Magic strings**: `'auto_transaction'` встречается 3 раза в transactions.ts
  + 1 в schema comment. Можно вынести `const AUTO_TX_SOURCE = 'auto_transaction'`.
- **TypeScript**: `as any` встречается дважды (`url.searchParams.get("type") as any`
  в index.ts:464, типы `any[]` в transactions.ts) — допустимо но not strict.
- **React 19**: `useEffect` для re-init модалок при `open` (`TransactionsPage.tsx:219-223,338-341,431-438`) — корректный паттерн, deps минимальны (только `open`).
- **TanStack Query**: `invalidateOnTxMutation` единый helper — invalidates
  `transactions`/`snapshots`/`accounts`. ✅ правильный scope, не invalidates
  `incomes`/`goals` (transactions их не трогают).
- **Tailwind**: классы группированы; `cn()` не злоупотребляется.
- **Accessibility**: `aria-label="Удалить"` на icon-only buttons. ✅
- **Dead code**: нет.

## Open questions

- **OQ1** (audit): должен ли `validateStep` для transfer падать при
  `from_amount !== to_amount`, или это сознательная гибкость (мог бы
  означать комиссию, скрытую без отдельного fee поля)? Если гибкость
  — задокументировать в spec; если нет — добавить validation.

- **OQ2** (audit): почему chain записывается не одним batch'ем, как
  явно специфицирует SPEC §8 ("Atomic batches ... Для chain — batch с
  2N + N inserts")? Это intentional упрощение (sequential для
  правильного prev_balance computation) или упущение? Если intentional,
  должно быть документировано как accepted trade-off.

- **OQ3** (audit): `roadmap.md` Stage 7.5 чекбоксы не отмечены как
  done — спецификация in_progress. После merge должны быть `[x]`.

- **OQ4** (audit): из SPEC §11 R4 — UI flip direction для rate < 1.
  Реализован (`TransactionsPage.tsx:159-163`). Но в `ChainDetailPage`
  и chain modal — та же логика. DRY-кандидат: `formatRate(from, to)`
  util. Не критично.
