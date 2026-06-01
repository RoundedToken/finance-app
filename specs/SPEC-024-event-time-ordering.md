---
id: SPEC-024
title: Детерминированный порядок событий во времени (created_at tie-break + локальная таймзона)
status: done
owner: stepan
created: 2026-06-01
updated: 2026-06-01
links:
  - adr: docs/decisions.md#adr-017
  - parent: SPEC-011   # денежная математика «effective balance», семантику которой уточняем
  - depends_on: [SPEC-011, SPEC-013, SPEC-021, SPEC-022]
---

# Детерминированный порядок событий во времени

> Стадия 2. Полный tier (меняется **денежная математика** границы снапшота + миграция D1). Корень — два бага из проверки 2026-06-01: (A) внутри одного дня события после снапшота молча выпадают из баланса; (B) даты операций и «сегодня» считаются в UTC, не в локальной зоне пользователя.

## 1. Context & Problem

`effective_balance` (SPEC-011) реконструируется по **только-дате** (`YYYY-MM-DD`), а граница снапшота строгая: событие учитывается лишь при `event.date > baseline.date` (семантика «снапшот = конец дня», `ledger.ts:38`, `snapshots.ts:85-97`, `dashboard.ts:160`). Из-за этого в один день порядок «расход → снапшот → доход» обрабатывается неправильно: всё, что введено в день снапшота, считается уже учтённым, и доход/трата, записанные **после** снапшота, теряются до следующего снапшота.

Параллельно `created_at` (полный timestamp записи) хранится **в разных форматах**: `expenses.created_at` пишется клиентом как ISO `2026-06-01T09:00:00.123Z` (`db.ts:48`, `MainScreen.tsx:34`), а у остальных таблиц — серверный `datetime('now')` → `2026-06-01 09:00:00`. Строковое сравнение между ними сломано (`' ' 0x20 < 'T' 0x54`).

Плюс «сегодня» и дефолтные даты операций считаются в **UTC** (`dashboard.ts:26`, `index.ts:325`, `*Page.tsx` через `toISOString().slice(0,10)`), из-за чего ночные/утренние операции у пользователя в UTC+1/+2 уезжают на соседний календарный день.

## 2. Goals

- **G1**: Внутри одного дня порядок событий относительно снапшота определяется **временем записи** (`created_at`): событие учитывается в балансе, если `event.date > baseline.date` **ИЛИ** (`event.date == baseline.date` И `event.created_at > baseline.created_at`). Это «порядок как я вводил».
- **G2**: Сохранён backdating: дата операции — главный ключ (событие за прошлую неделю остаётся за прошлой неделей). `created_at` решает **только** ничью при равной дате.
- **G3**: `created_at` приведён к единому каноничному формату `YYYY-MM-DD HH:MM:SS` (UTC) во всех таблицах; новые расходы получают **серверный** `created_at` (убираем зависимость от часов телефона для порядка).
- **G4**: Даты операций (дефолты в Mini App и Admin) и серверное «сегодня» (`/accounts`, `/dashboard` asOf) — в **локальной зоне пользователя**, а не UTC.
- **G5**: Обе реализации формулы (`snapshots.ts:getEffectiveBalance` и `dashboard.ts:balanceAt`/`ledger.ts:reconstructBalance`) остаются зеркалами друг друга и покрыты тестами на новую границу.

## 3. Non-Goals

- **NG1**: НЕ вводим ручной ввод времени операций (полные timestamps на UI). Mini App остаётся input-less; `created_at` (порядок ввода) и так даёт нужный сигнал.
- **NG2**: НЕ мигрируем исторические `date` операций под локальную зону — исходный локальный день UTC-датированной строки не восстановить надёжно (backdated-строки имеют `created_at != date` намеренно). Локальные даты — только вперёд.
- **NG3**: НЕ трогаем месячные агрегаты (cashflow, expenses_by_category, net-worth-series по концу месяца) — там date-гранулярности достаточно, граница снапшота их не касается.
- **NG4**: НЕ перестраиваем мультипользовательскую модель таймзон. Single-user: «сегодня» = день устройства пользователя.

## 4. User journeys

### Happy path (баг, который чиним)
Ведро `eur-cash`, один день:
1. Трата 10 € (date = сегодня) — записал **до** снапшота.
2. Снапшот 90 € (date = сегодня, created_at = 10:00) — пересчитал кошелёк.
3. Доход 50 € (date = сегодня, created_at = 11:00) — записал **после** снапшота.

**Было:** baseline = снапшот 90 €; и трата, и доход отброшены (`date == baseline.date`) → баланс 90 € (неверно).
**Стало:** трата (created_at < 10:00) остаётся «внутри» снапшота → не добавляется (верно, 90 уже её учитывает); доход (created_at 11:00 > 10:00) → добавляется → баланс **140 €** (верно).

### Edge cases
- **E1 (нет baseline):** снапшота нет → `baseline.date = "0000-01-01"`, все события суммируются (без изменения поведения).
- **E2 (backdating):** сегодня снапшот, завтра ввожу трату за прошлую неделю (date < snapshot.date) → дата главнее, трата НЕ всплывает после снапшота (верно).
- **E3 (несколько снапшотов в день):** baseline = снапшот с максимальным `created_at` среди `date <= asOf` (как сейчас, `ORDER BY date DESC, created_at DESC`).
- **E4 (равный created_at):** событие с `created_at == baseline.created_at` → НЕ добавляется (строгое `>`). Практически недостижимо (разные инстансы записи), осознанно.
- **E5 (остаточный край):** задним числом ввести событие на дату снапшота **после** записи самого снапшота → попадёт «после» (created_at больше). Редко; самоисправляется следующим снапшотом. Зафиксировано в Risks.
- **E6 (полночь, локальная зона):** трата в 01:00 по локали (= 23:00 UTC прошлого дня) получает локальную дату (сегодня), а не UTC-вчера.

## 5. Data model

Без новых таблиц/колонок. Одна нормализующая миграция + единый формат `created_at`.

```sql
-- 0013_normalize_expenses_created_at.sql (SPEC-024)
-- Канонизируем формат created_at/updated_at в expenses под 'YYYY-MM-DD HH:MM:SS'
-- (как datetime('now') в остальных таблицах). Старые строки писались клиентом как
-- ISO '...T...Z' → ломают межтабличное строковое сравнение created_at. Чистый
-- реформат: момент времени не меняется (UTC→UTC, отбрасываем мс/Z). Суммы НЕ трогаем.
UPDATE expenses SET created_at = replace(substr(created_at, 1, 19), 'T', ' ') WHERE created_at LIKE '%T%';
UPDATE expenses SET updated_at = replace(substr(updated_at, 1, 19), 'T', ' ') WHERE updated_at LIKE '%T%';
```

Семантика:
- **`created_at`** — каноничный `YYYY-MM-DD HH:MM:SS` (UTC, секундная точность) во всех транзакционных таблицах. Это **порядок записи** = tie-break внутри дня. Остаётся в UTC (абсолютное время; для порядка зона не нужна).
- **`date`** — `YYYY-MM-DD`, **локальный** день пользователя (с этой фичи — вперёд). Экономическая дата операции, может быть backdated.

## 6. Алгоритм (ядро фичи)

Единая формула (зеркала в `ledger.ts` + `snapshots.ts` SQL):

```
balance(asOf) = baseline.amount
              + Σ event.delta  где  event.date <= asOf
                                    И ( event.date >  baseline.date
                                        OR (event.date == baseline.date
                                            AND event.created_at > baseline.created_at) )
baseline = последний manual snapshot ведра с date <= asOf
           (ничья по date → max created_at)
нет baseline → amount=0, date="0000-01-01", created_at="" (created_at-ветка не срабатывает)
```

Затрагиваемые места:
- `ledger.ts:reconstructBalance` — новая сигнатура `(baselineAmount, baselineDate, baselineCreatedAt, events: {date, createdAt, delta}[], asOf)`.
- `snapshots.ts:getEffectiveBalance` — baseline-запрос добавляет `created_at`; каждая SUM-подзапрос (income/expense/tx-out/tx-in/goal_contrib/fee) меняет `date > ?` на `date <= ? AND (date > ? OR (date = ? AND created_at > ?))`.
- `dashboard.ts:balanceAt` — `SnapRow`/`NativeEvent` несут `created_at`; SELECT-ы добавляют `created_at`; вызов `reconstructBalance` с новой сигнатурой.
- `db.ts:createExpense` + `bot.ts` — `created_at` ставится сервером (`datetime('now')`), не клиентом. `bulkInsertExpenses` нормализует входной `created_at` (substr/replace) на случай ISO из импортов.

## 7. Таймзона (G4)

- **Клиенты:** единый `todayLocal()` = `${y}-${pad(M)}-${pad(D)}` из `getFullYear/getMonth/getDate` (зона устройства). Заменяет UTC-`toISOString().slice(0,10)` в дефолтах дат: Mini App (`lib/utils.ts`), Admin `SnapshotsPage`/`TransactionsPage`/`GoalDetailPage`/`IncomesPage`. `DashboardPage`/`PeriodPicker` уже локальны — не трогаем.
- **Сервер:** `/v1/web/accounts` и `/v1/web/dashboard` принимают опциональный `?today=YYYY-MM-DD` (локальное «сегодня» клиента); валидируется regex; fallback — UTC (текущее поведение, безопасно). Используется как asOf для балансов «сейчас» и якорь KPI-окна. Admin-queries (`queries.ts`) прокидывают `todayLocal()`.
- **created_at** — остаётся UTC, не локализуется (порядок = абсолютное время).

## 8. Security

- Auth не меняется (`/accounts`, `/dashboard` — Bearer JWT; expenses — initData/bot). `?today=` приходит от доверенного single-user, но **валидируется** форматом (ISO date regex), не используется в SQL-интерполяции (только bind/сравнение строк).
- Финансовые суммы миграцией **не трогаются** — только реформат строки времени. Перед применением — backup D1 (правило 7).
- В логи `created_at`/`today` не добавляем.

## 9. Acceptance criteria

- [x] AC1: GIVEN снапшот 90 € (date=D, created_at=10:00) и доход 50 € (date=D, created_at=11:00) WHEN `getEffectiveBalance(asOf>=D)` THEN баланс = 140 € (доход после снапшота учтён).
- [x] AC2: GIVEN трата 10 € (date=D, created_at=09:00) перед снапшотом 90 € (date=D, created_at=10:00) WHEN баланс THEN = 90 € (трата «внутри» снапшота, не вычитается повторно).
- [x] AC3: GIVEN снапшот (date=D) и событие (date<D, created_at позже снапшота) THEN событие НЕ учитывается после baseline (backdating: дата главнее created_at).
- [x] AC4: `dashboard.ts:balanceAt` и `snapshots.ts:getEffectiveBalance` дают одинаковый баланс на одинаковых данных для всех AC1-AC3 (зеркальность).
- [x] AC5: Миграция 0013 переводит ISO-`created_at` в `YYYY-MM-DD HH:MM:SS`, не меняя момент времени; строки уже в каноне не трогаются; суммы не меняются.
- [x] AC6: Новый расход (Mini App/bot) получает серверный `created_at` каноничного формата (не из тела запроса).
- [x] AC7: Дефолт даты в формах Mini App/Admin = локальный день устройства (тест: при подмене зоны UTC+2 в 23:30 локально дата = локальное «сегодня», не UTC-завтра).
- [x] AC8: `/accounts` и `/dashboard` с `?today=YYYY-MM-DD` используют его как asOf; без него — UTC fallback; невалидный `today` → fallback (не 500).
- [x] AC9: Регрессия — существующие тесты `effective-balance`/`dashboard`/`ledger` зелёные после правки границы (обновлены под новую сигнатуру/семантику).

## 10. Test plan

- **Worker (vitest + d1-mock):** новые кейсы в `effective-balance.test.ts` (AC1-AC4), `ledger.test.ts` (новая сигнатура `reconstructBalance` + tie-break), `dashboard.test.ts` (зеркальность balanceAt). Мок гоняет реальный SQL → ловит SQL-границу.
- **Миграция:** локальный прогон `wrangler d1 execute --local` на снимке с ISO/space строками; проверка идемпотентности (повторный прогон не портит каноничные).
- **Клиенты:** Playwright Admin (`test_admin_ui.py`) — дефолт даты формы; Playwright Mini App (`test_miniapp_react.py`) — дефолт даты; локальный визуал-тест light/dark перед деплоем (правило `frontend-test-locally-before-deploy`).
- **Regression:** `/accounts` net/targeted/free всё ещё сходится; overdraft-check в `createExpense` (asOf=date) корректен с новой границей.

## 11. Risks & open questions

- **R1 (остаточный край E5):** backdated событие на дату снапшота, введённое после него, попадёт «после» — редко, самоисправляется следующим снапшотом. Принято.
- **R2 (миграция created_at):** реформат массовый; делаем backup D1 до применения; substr/replace — чистая строковая операция (без парсинга дат, без риска tz-сдвига).
- **R3 (mixed dates):** исторические UTC-`date` + новые локальные `date` сосуществуют; на границе суток возможен старый off-by-one в истории — не мигрируем (NG2), self-heal снапшотами.
- **R4 (clock-skew):** серверный `created_at` на расходах убирает зависимость от часов телефона; для уже записанных строк порядок остаётся как был.

## 12. Out of scope для review

- Полные timestamps на UI (NG1), мультипользовательские зоны (NG4), миграция исторических дат (NG2) — сознательно отложено.

## 13. Changelog spec'а

- 2026-06-01: создан сразу в `in_progress` (направление одобрено owner'ом через AskUserQuestion: «по времени записи» + «чинить таймзону локально»; правило 15 + autonomous-push-deploy).
- 2026-06-01: реализация (worker формула+миграция 0013, клиенты, тесты). `Phase 3: qa=PASS_WITH_NICES, arch=APPROVED_WITH_NICES` (0 must-fix). 102 vitest зелёные на реальном SQLite (мок гоняет SQL воркера) + typecheck worker/admin/miniapp. Nice-to-have применены: deploy-order заметка в миграции (применять до/с деплоем worker), убран мёртвый `created_at` из payload Mini App, +AC6 unit-тест (`createExpense` серверный created_at). Backlog: вестигиальное `created_at` в `expenseCreateSchema`/`ExpensePayload` (нужно для `bulkInsert`).
- 2026-06-01: `done` — выкачено на прод (PR #4 squash-merge). Порядок: backup D1 → миграция 0013 через `d1 execute --file` (1847 expenses ISO→канон, 0 остаточных; `migrations apply` НЕ использован — трекинг рассинхронизирован, 0006-0012 применялись out-of-band) → deploy worker → idempotent-добивка (0 gap-строк) → build+визуал-харнес admin (формы рендерятся, дата=локальный сегодня) → deploy admin/miniapp Pages (HTTP 200). Прод-импакт: 23 реальных операции (19 доходов + 4 траты) в день снапшота после него теперь корректно учитываются (раньше выпадали).
