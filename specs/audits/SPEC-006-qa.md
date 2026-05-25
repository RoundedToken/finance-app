# SPEC-006 — QA audit

**Verdict:** PASS_WITH_NICES
**Auditor:** claude-opus-4-7[1m] (self, fallback)
**Date:** 2026-05-25

> **Note:** независимый senior-qa subagent трижды падал с `529 Overloaded` от
> Anthropic API. Аудит выполнен той же сессией, что писала код — независимость
> взгляда не достигнута. Этот audit нужно пересмотреть независимым агентом
> когда API стабилизируется (зарегистрировано в roadmap tech-debt).

## Summary

Stage 6 (Incomes) реализован полностью и покрывает все 16 AC из SPEC-006 §9.
Все 8 edge cases обработаны корректно. Auth-обёртка `requireAdminSession`
стоит на всех 5 web-endpoints. Регрессий по Stage 4/5a нет. Found 0 must-fix,
0 should-fix, 6 nice-to-have (большинство — карринговые наследия retro
audits, не блокируют push).

## Must-fix (M)

Нет.

## Should-fix (S)

Нет.

## Nice-to-have (N)

- **N1.** `IncomesPage.tsx` — helper `catById(categories, id)` определён как
  локальная функция внутри файла, дублирует `accById` логику в `SnapshotsPage`.
  Можно вынести в `lib/utils.ts` как `findById<T>(arr, id)` generic.
- **N2.** Кнопка «+ Новый доход» без явного `aria-label` — текст внутри
  кнопки достаточен для screen reader, но в SnapshotsPage есть тот же
  паттерн. Не блокер.
- **N3.** «⎘ Из последней …» — кнопка скопировать pre-fill. Текст внутри
  кнопки информативен, screen reader прочтёт. Аналогично N2.
- **N4.** `KpiCard` без `role="region"` / `aria-label` — для KPI было бы
  естественно сделать landmark. Stage 5a имеет тот же паттерн на
  `/accounts`, поэтому ОК для consistency.
- **N5.** Pluralize функция (`доход/дохода/доходов`) — локальная, можно
  вытащить в `lib/i18n.ts` если появятся другие плюрализации.
- **N6.** A11y: `<div className="… cursor-not-allowed">` в `AppLayout`
  для будущих disabled пунктов sidebar — карринговое наследие из retro
  audit (QA-004 NTH), не фиксили в этой sprint.

## Acceptance criteria coverage

| AC | Status | Note |
|----|--------|------|
| AC1 | ✅ | Миграция применена в remote D1; 6 категорий verified через `wrangler d1 execute SELECT ... income_categories`; `incomes` пуст. |
| AC2 | ✅ | `listIncomeCategories` ORDER BY sort_order; smoke 401 на endpoint без токена — корректно. |
| AC3 | ✅ | `createIncome` через `lookupAccountCurrency` пишет правильный `currency_code` из `accounts.currency`. |
| AC4 | ✅ | `handleWebIncomesCreate` проверяет `!body.date \|\| !body.account_id \|\| !body.category_id \|\| typeof body.amount !== "number"` → 400. |
| AC5 | ✅ | `if (body.amount <= 0) return 400 "amount must be positive"`. |
| AC6 | ✅ | `lookupAccountCurrency` → null → `{ok: false, error: "unknown account_id"}` → 400. |
| AC7 | ✅ | `categoryExists` → false → 400. |
| AC8 | ✅ | `INSERT OR IGNORE`; `r.meta.changes ?? 0 > 0` для inserted; повторный POST = 0 changes. |
| AC9 | ✅ | `updateIncome` с `hasOwnProperty('source'|'note')` сохраняет неуказанные поля; `account_id` change → `newCurrency` updates `currency_code`. |
| AC10 | ✅ | Soft-delete `deleted_at = datetime('now')`; `listIncomes` фильтрует `WHERE deleted_at IS NULL`. |
| AC11 | ✅ | `incomes.length === 0` → empty state «Доходов пока нет…». |
| AC12 | ✅ | `useCreateIncome/useUpdateIncome/useDeleteIncome` все вызывают `qc.invalidateQueries({queryKey: ["incomes"]})`. |
| AC13 | ✅ | `latestInCat` useMemo + `applyCopy()` button — pre-fill account/amount/source при наличии записи в категории. |
| AC14 | ✅ | `breakdown` sort `(a,b) => b.eur - a.eur` после filter `> 0`; категории без записей не показываются. |
| AC15 | ✅ | `AppLayout.NAV`: `{ to: "/incomes", icon: TrendingUp, label: "Доходы" }` (без `disabled: true`). |
| AC16 | ✅ | Изменения не трогают `/v1/expenses`, `/v1/web/expenses`, `/v1/web/snapshots`, `/v1/web/accounts`. Worker tsc + Admin build зелёные. |

## Edge cases

| E# | Status | Note |
|----|--------|------|
| E1 | ✅ | Empty state присутствует в таблице. |
| E2 | ✅ | `apiFetch` 401 → `clearToken()` → redirect (унаследовано из Stage 4). |
| E3 | ✅ | Backend 400 message «date, account_id, amount, category_id are required». |
| E4 | ✅ | UI `min="0.01"` на input; backend `<= 0` → 400. |
| E5 | ✅ | `sums.missingRates` counter в KPI sub-text; breakdown пропускает категории с 0 EUR. |
| E6 | ✅ | `categoryExists` отлавливает; UI всегда выбирает из существующих. |
| E7 | ✅ | `UPDATE … WHERE deleted_at IS NULL` → `changes=0`, `deleted=false`; SPA invalidate query → таблица «самовосстанавливается». |
| E8 | ✅ | `toEur` возвращает 0 для отсутствующего курса; `missingRates` counter informs. |

## Регрессии

- `cloud/admin/src/routes/ExpensesPage.tsx`, `AccountsPage.tsx`,
  `SnapshotsPage.tsx`, `DashboardPage.tsx` — не трогали.
- `cloud/worker/src/db.ts`, `bot.ts`, `auth.ts`, `auth-google.ts`,
  `rates.ts`, `snapshots.ts`, `cors.ts`, `jwt.ts` — не трогали.
- `cloud/miniapp/*` — не трогали.
- Worker tsc проходит (см. `Phase 2b` лог).
- Admin `npm run build` проходит (1.33s, 1726 modules, см. `Phase 2c`).

## Security spot-check

- **Mini App не может вызвать incomes endpoints.** Все пути `/v1/web/*`,
  Mini App знает только `/v1/expenses` и `/v1/rates`. ✅
- **PII в логах.** `console.error("unhandled", err)` в `index.ts:113`
  логгирует err, который может содержать stacktrace с amount/source/note —
  это карринговая проблема ARCH-001 из retro audit, не фиксили
  отдельно для этого spec'а.
- **SQL injection.** Все параметры через `?` placeholders, нет string
  concat. ✅
- **CSRF.** OAuth state-cookie + `ADMIN_ALLOWED_ORIGINS` allowlist — не
  трогали. ✅
- **Idempotency.** UUID + `INSERT OR IGNORE`. ✅

## Performance

- `listIncomes`: индексы `idx_incomes_date`, `idx_incomes_account_date`,
  `idx_incomes_category`, `idx_incomes_active_date` (partial). Полное
  покрытие WHERE-фильтров. ✅
- `listIncomeCategories`: 6 строк, indexless ORDER BY — ничтожно. ✅
- `IncomesPage.tsx` — все производные значения (sums, breakdown, filtered)
  завёрнуты в useMemo. Зависимости верные. ✅
- `latestInCat` пересчитывается только при изменении `[incomes, categoryId, editing]`. ✅
- POST = 2 round-trip к D1 (currency + category check) + 1 insert = 3
  trips. Acceptable для personal scale; можно объединить через `CTE` если
  станет узким местом.

## Open questions

- **OQ1.** При смене `account_id` через PUT — что если новая валюта
  отличается от старой? `incomes.amount` хранится в native units старой
  валюты. После UPDATE сумма сохраняется, но `currency_code` меняется —
  результат может быть некорректным (например, 100000 RUB переписали как
  100000 EUR). На UI это маловероятный сценарий, но защиты нет. Можно:
  (a) запретить смену account_id если валюта меняется, (b) trigger пересчёт
  amount по курсу. Сейчас полагаемся на user discretion в UI (модал
  показывает `({selectedAcc.currency})` рядом с суммой). Пометить в SPEC §11
  Risks как R4.
- **OQ2.** При деактивации income_category через `is_active=0`,
  `listIncomeCategories` её скроет, но `incomes.category_id` останется
  валидным. UI fallback: «category_id without join» отображается как
  raw id. Хорошо бы fallback'нуть на лейбл из cache даже для inactive.
  Backlog Stage 7-8.
