---
id: SPEC-032
title: Согласованность валюта↔счёт при вводе траты (auto-bind + осознанный override)
status: done
owner: stepan
created: 2026-06-22
updated: 2026-06-22
links:
  - adr: docs/decisions.md#adr-012
  - depends_on: [SPEC-014, SPEC-019]
---

# Согласованность валюта↔счёт при вводе траты

> Фидбэк owner (2026-06-22): «бывает, выбираю счёт (напр. RSD·банк), а валюта по факту рубль —
> очевидная ошибка, но мне как пользователю она незаметна. Нужен визуальный сигнал и, возможно,
> предотвращение — чтобы так нельзя было, если это не осознанный выбор. Плюс аудит уже введённых
> данных на смешивание валюты и счёта.»

## 1. Context & Problem

Счёт (`accounts`) — это ведро, денoминированное в **одной** валюте (`accounts.currency`). Тратить из
ведра можно только в его валюте: движок баланса (`effective_balance`, SPEC-011) учитывает расход в
**native-валюте ведра**. Значит для траты со счётом инвариант `expenses.currency == accounts.currency`
обязателен — иначе «999 RSD на RUB-ведре» вычитается как 999 RUB, тихо искажая баланс.

Сейчас в Mini App счёт и валюта — два **независимых** поля без связки:
- `store.tsx → freshDraft()` хардкодит `currency: "RSD"`, а счёт берёт из localStorage (липкий
  последний). Выбор счёта валюту не трогает, выбор валюты счёт не трогает.
- Ни Zod-схема (`expenseCreateSchema`), ни домен (`createExpense`/`updateExpense`) рассогласование не
  ловят.
- Пользователю ошибка не видна — нет ни сигнала, ни предотвращения.

**Аудит прод-данных (2026-06-22).** Среди 94 трат Mini App со счётом (диапазон 2026-05-22…06-22) —
ровно **1** рассогласованная запись (`150bf574…`: 999, валюта RSD, счёт `rub-bank`/RUB, кат. Подписки
«Етель»). `incomes`/`goal_contributions` — 0 рассогласований (Web Admin деривит валюту из счёта).
Бот (`bot.ts`) и CSV-импорт пишут `account_id = NULL` → не подвержены. Owner-решение: запись = 999 RSD,
неверен **счёт** → перевесить на `rsd-bank`.

## 2. Goals

- **G1**: при выборе счёта в Mini App валюта **автоматически** становится валютой счёта (auto-bind).
  Промах «выбрал RSD-счёт, осталась RUB» структурно невозможен в обычном потоке.
- **G2**: записать трату со счётом в **другой** валюте можно только через **явное подтверждение**
  («так бывает редко») — осознанный override сохранён.
- **G3**: любое рассогласование (после override или при правке легаси-записи) показано **визуально**
  (amber-сигнал на валюте + счёте) — невидимых ошибок не остаётся.
- **G4**: сервер (`createExpense`/`updateExpense`) **отклоняет** немаркированное рассогласование
  (account-bound `currency != account.currency` без флага override) → 400. Защита от старого/багнутого
  клиента, defense-in-depth поверх UI.
- **G5**: единственная историческая рассогласованная запись исправлена на проде (точечно, обратимо).

## 3. Non-Goals

- **NG1**: не трогаем бот и CSV-импорт (они пишут `account_id = NULL`, рассогласование невозможно).
- **NG2**: не трогаем Web Admin (доходы/обмены/взносы) — там валюта уже деривится из счёта; обмен
  (`transactions`) законно имеет разные `from_currency`/`to_currency` (это не баг).
- **NG3**: не меняем модель данных (`expenses.currency` остаётся отдельным полем — нужно для трат
  «без счёта», где валюта свободна и используется только для EUR-конверсии/репортинга).
- **NG4**: не добавляем в Admin отдельный «data-health»-экран на рассогласования (разовый аудит закрыт
  здесь; постоянный мониторинг — post-MVP, если понадобится).

## 4. User journeys

### Happy path (обычный ввод)
1. Пользователь открывает Mini App. Драфт стартует с липким счётом и **его** валютой (consistent).
2. Меняет счёт на `rsd-bank` → валюта **сразу** становится RSD (auto-bind). Дисплей: `💱 RSD`.
3. Вводит сумму, тапает категорию → сохраняется RSD-трата на RSD-счёт. Сервер принимает (match).

### Осознанный override
1. Выбран счёт `rub-bank` (валюта RUB, дисплей `💱 RUB`).
2. Пользователь тапает по индикатору валюты → confirm: «Валюта привязана к счёту «RUB · банк» (RUB).
   Записать в другой валюте? Так бывает редко». 
3. Подтверждает → открывается пикер валют, выбирает напр. EUR.
4. Дисплей показывает `💱 EUR ⚠` amber + строка «⚠️ счёт RUB, валюта EUR». Клиент шлёт
   `allow_currency_mismatch: true`. Сервер принимает.

### Edge cases
- **E1 — правка легаси-рассогласования**: открыл старую запись (RSD на RUB-счёте) в EditScreen → видит
  amber-сигнал. Может починить (тап счёт → `rsd-bank`, auto-bind оставит RSD → match) или сохранить
  как есть (флаг override → сервер примет).
- **E2 — «Без счёта»**: валюта свободна (пикер открывается без confirm), рассогласования быть не может
  (нет счёта) → сервер не проверяет.
- **E3 — смена счёта поверх override**: выбрал EUR override на RUB-счёте, затем сменил счёт на
  `eur-bank` → auto-bind ставит EUR → теперь match, amber гаснет.
- **E4 — старый клиент** (до деплоя) шлёт рассогласование без флага → сервер 400 (G4); пользователь
  на старом кэше получает ошибку сохранения, перезагрузка Mini App подтягивает новый клиент.

## 5. Data model

Схема D1 **не меняется**. Инвариант (для трат со счётом): `expenses.currency == accounts.currency`.
Документируется в `docs/data-model.md` (раздел `expenses`).

**Разовый фикс данных** (прод, обратимо — старое `account_id = 'rub-bank'`):
```sql
UPDATE expenses SET account_id = 'rsd-bank', updated_at = datetime('now')
 WHERE id = '150bf574-1592-4c15-a454-c6614163e4c5' AND deleted_at IS NULL;  -- 1 строка
```

## 6. API contract

### `POST /v1/expenses` (Mini App, initData)
- Request: существующий payload + **новое опциональное** `allow_currency_mismatch?: boolean`.
- Валидация (домен `createExpense`): если `account_id` задан и `account.currency != currency` и
  **не** `allow_currency_mismatch` → **400** `{ "error": "валюта траты (RSD) не совпадает с валютой
  счёта «RUB · банк» (RUB)" }`.
- Match или флаг выставлен → 200 как раньше.

### `PUT /v1/expenses/:id` (Mini App, initData)
- Тот же флаг. Валидация по **результирующим** значениям после patch (`patch.account_id ?? existing`,
  `patch.currency ?? existing`). Рассогласование без флага → 400.

Zod (`schemas.ts`): `allow_currency_mismatch: z.boolean().optional()` в `expenseCreateSchema` и
`expenseUpdateSchema`. Граница ответственности (SPEC-019): Zod = shape; FK-валюта-сверка = домен (нужен D1).

## 7. UI / UX (Mini App)

**Auto-bind.** Выбор счёта в `AccountPicker` диспатчит валюту счёта → `currency` синхронизируется.
Липкий дефолт драфта тоже консистентен (храним валюту последнего счёта в localStorage).

**Override-гейт.** Тап по индикатору валюты на главной/в edit: если выбран счёт и валюта = валюте
счёта → `confirmDialog`. Только подтверждение открывает пикер. «Без счёта» → пикер сразу.

**Сигнал рассогласования.** Когда `account && currency != account.currency`:
```
Дисплей:   999
           💱 EUR ⚠        ← amber
[ Счёт: RUB · банк ]
⚠️ счёт RUB, валюта EUR     ← amber-строка
```
amber (не красный alarm): рассогласование тут всегда осознанное (override/легаси), но обязано быть видимым.

## 8. Security

- Auth не меняется: оба endpoint'а под `authenticateMiniApp` (initData HMAC).
- Новый input `allow_currency_mismatch` — boolean, валидируется Zod. Не влияет на auth/allowlist.
- Финансовые суммы/валюты — не логируются (как и раньше). Сообщение об ошибке 400 содержит коды валют
  и имя счёта (не PII).

## 9. Acceptance criteria

- [ ] AC1: в Mini App выбор счёта `rsd-bank` ставит валюту RSD автоматически (дисплей `💱 RSD`).
- [ ] AC2: тап по валюте при счёте с совпадающей валютой показывает confirm; отмена не открывает пикер.
- [ ] AC3: после подтверждённого override валюта ≠ счёта показана amber + строкой-предупреждением.
- [ ] AC4: `POST /v1/expenses` с `account_id=rub-bank, currency=RSD` без флага → 400 с понятным текстом.
- [ ] AC5: тот же POST с `allow_currency_mismatch=true` → 200.
- [ ] AC6: `POST` с `account_id=rsd-bank, currency=RSD` (match) → 200 (регресс не сломан).
- [ ] AC7: `PUT` смена счёта на разно-валютный без флага → 400; с флагом → 200.
- [ ] AC8: фикс прод-записи `150bf574…` применён; повторный аудит даёт 0 рассогласований.
- [ ] AC9: бот (`account_id=NULL`) и трата «без счёта» сохраняются без проверки валюты (регресс).

## 10. Test plan

- **Worker (vitest, d1-mock)**: новый `test/expense-currency-consistency.test.ts` — createExpense match/
  mismatch±flag/без счёта; updateExpense смена счёта на разно-валютный ±flag. + `schemas.test.ts` на флаг.
- **Mini App (Playwright, light/dark)**: auto-bind при смене счёта, override-confirm, amber-сигнал
  (memory `frontend-test-locally-before-deploy`). tsc --noEmit.
- **Прод-верификация**: фикс записи → повторный аудит-SELECT = 0; smoke POST mismatch → 400.

## 11. Risks & open questions

- R1: старый закэшированный клиент шлёт рассогласование без флага → 400 (E4). Приемлемо: single-user,
  перезагрузка чинит; альтернатива (молча принять) опаснее — вернёт класс багов.
- R2: confirm на каждый тап валюты при выбранном счёте слегка назойлив. Митигируем: гейт только когда
  валюта **совпадает** со счётом (т.е. реально собираются отклониться); при уже-рассогласованной
  (легаси) пикер открывается сразу.

## 12. Changelog

- 2026-06-22: аудит прод-D1 (1 рассогласованная трата), решения owner (запись=999 RSD; защита=auto-bind
  + осознанный override + серверный 400). Спека, status → in_progress.
- 2026-06-22: имплементация. Worker — `db.ts:currencyMismatchError` + проверка в `createExpense`/
  `updateExpense` (по результирующим значениям, early-return без SELECT для патчей без валюты/счёта),
  400 в `index.ts`, Zod-флаг `allow_currency_mismatch` в `schemas.ts`, тип в `types.ts`. Mini App —
  auto-bind (`store.tsx` `account`-action + `ACC_CCY_KEY`, `Modals.tsx`), confirm-гейт + amber-сигнал
  (`MainScreen`/`EditScreen`), reconcile-эффект, резолв счёта из полного (не-external) списка (фикс
  dead-end на неактивном счёте), флаг при сохранении. Тесты: `expense-currency-consistency.test.ts`
  (9) + флаг в `schemas.test.ts` → 157 vitest зелёные; tsc worker+miniapp чисто; vite build ок.
  Doc-инвариант в `docs/data-model.md`. AC1–AC9 покрыты.
- 2026-06-22: Phase 3 dual-gate (solution-architect ∥ senior-qa + adversarial verify) — оба **approved**,
  0 подтверждённых must-fix; из nice-to-have взяты 4 (doc-инвариант, dead-end неактивного счёта,
  early-return SELECT, тест флага), 3 косметики/owner-решения оставлены (amber-flash на холодном старте
  self-heal'ится reconcile'ом; нага confirm — R2; гейт на amount>0 — отклонено, ослабляет prevention).
- 2026-06-22: фикс прод-данных — запись `150bf574…` `account_id` `rub-bank`→`rsd-bank` (changes=1,
  обратимо); повторный аудит = **0 рассогласований** (AC8). Локальный Playwright light/dark: auto-bind,
  override-amber, EditScreen-легаси — все проверки прошли, 0 console errors.
- 2026-06-22: PR #18 squash-merge в `main` (CI зелёный: worker/admin/miniapp). Деплой: Worker
  `b7c37174` (`npm run deploy`), Mini App Pages (`index-Rg2tLlqE.js`). Миграций D1 нет (схема не
  менялась). Прод-смоук: POST `/v1/expenses` без auth → 401 (endpoint live), Mini App отдаёт новый
  билд, аудит на проде = 0 рассогласований. status → done (выкачено на прод).
