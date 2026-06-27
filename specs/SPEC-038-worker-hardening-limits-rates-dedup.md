---
id: SPEC-038
title: Worker hardening — parseLimit + cap, budget limit cap, bootstrap rates-dedup
status: in_progress
owner: stepan
created: 2026-06-27
updated: 2026-06-27
links:
  - parent: review-mvp-stage1   # post-mvp 2.8 + хвост 1.8
  - depends_on: [SPEC-016, SPEC-020, SPEC-023]
---

# Worker hardening — limits + bootstrap rates-dedup

## 1. Context & Problem

Тех-долг worker'а, накопленный ревью (post-mvp 2.8 + хвост 1.8), под защитой CI:

1. **`?limit` не валидируется.** 5 хендлеров делают `parseInt(searchParams.get("limit") ?? "<def>", 10)`.
   При `?limit=abc` → `NaN` (а `?? "<def>"` его не ловит: NaN не nullish) → `LIMIT NaN` в SQL.
2. **`/v1/admin/bulk-rates` без cap.** `items.map(...) → env.DB.batch(stmts)` без ограничения
   размера массива и без валидации элементов — огромный/мусорный payload бьёт по D1.
3. **`limit_eur` бюджета без верхней границы.** `limit_eur: z.number().positive()` — fat-finger
   (лишний ноль, `3000000`) проходит и ломает шкалы дашборда/бюджетов.
4. **Bootstrap грузит RatesIndex 3× за запрос.** `loadRatesIndex` = `SELECT … FROM rates WHERE
   base='EUR'` (скан ВСЕЙ таблицы rates; растёт ~5/день годами → десятки тысяч строк). На каждом
   открытии Mini App `getBootstrapData` зовёт его трижды: внутри `listExpenses`, `getBudgetsWithProgress`
   и envelopes (`getEnvelopesForBootstrap`→`loadCommon`). Тройной полный скан на самом частом входе.

(Двойной `loadRatesIndex` на `/accounts` и `references`-discard уже закрыты Фазой 1.8 — здесь не трогаем.)

## 2. Goals

- G1: Хелпер `parseLimit(raw, def, max)` — парсит `?limit`, при NaN/≤0 → `def`, клампит к `max`;
  применён во всех 5 list-хендлерах (expenses Mini App / expenses Web / snapshots / incomes / transactions).
  `?limit=abc` → дефолт, `?limit=99999999` → `max`.
- G2: `/v1/admin/bulk-rates` отвергает payload > `MAX_BULK_RATES` (400) и пропускает невалидные
  элементы (нет `date`/`quote`, нерациональный `rate`).
- G3: `limit_eur` бюджета (create/update) ограничен сверху разумным `.max` (catch fat-finger),
  сохраняя `.positive()`.
- G4: `getBootstrapData` грузит `RatesIndex` **один раз** и передаёт в `listExpenses`,
  `getBudgetsWithProgress`, `getEnvelopesForBootstrap` (→`loadCommon`) — bootstrap rates 3×→1×.
- G5: Поведение существующих ответов **не меняется** (та же форма/числа на валидных входах) — это
  hardening и перф, не фича. Покрыто vitest (worker `npm test`).

## 3. Non-Goals

- NG1: Серверная keyset-пагинация / перенос фильтров на сервер (отложено по триггеру, post-mvp 3.4).
  `parseLimit` — только валидация существующего `?limit`, не новая модель пагинации.
- NG2: Request-scoped мемоизация `loadRatesIndex` (кэш на env/изолят). Отвергнуто: env переживает
  изолят между запросами → риск устаревших курсов. Берём явный threading `rates?: RatesIndex`
  (паттерн уже в `listGoals`/`investments`/`getBudgetProgress`).
- NG3: Дедуп `expenses`-чтения в bootstrap. `listExpenses` (полный набор), `getBudgetsWithProgress`
  (окно месяца) и envelopes (RBAR-окно) читают РАЗНЫЕ срезы трат — не сводятся. Дедупим только rates.
- NG4: Изменение `/accounts` и `references` (уже исправлены Фазой 1.8).
- NG5: Чанкинг bulk-rates на стороне сервера. Cap + 400 достаточно (клиент-backfill уже батчит по 500).
- NG6: Кап на прочие денежные поля (доход/снапшот/обмен). Здесь — только `limit_eur` (пример из ревью);
  остальное — отдельно, если всплывёт.

## 4. User journeys

Внешнего UX нет (worker-внутреннее). Наблюдаемые эффекты:

### Happy path
1. Admin/Mini App грузят списки/bootstrap как раньше — те же данные, bootstrap слегка быстрее
   (1 скан rates вместо 3).
2. Бюджет с разумным `limit_eur` создаётся как раньше.

### Edge cases
- E1: `?limit=abc` / `?limit=-5` / `?limit=` → используется дефолт эндпоинта (не `LIMIT NaN`).
- E2: `?limit=99999999` → клампится к `max` (защита от выгрузки всего + переполнения).
- E3: `bulk-rates` с 50 000 элементов → `400 { error: "too many" }` (не валит D1).
- E4: `bulk-rates` с элементом без `quote` / с `rate: "x"` → элемент пропущен, остальные вставлены;
  ответ `{ inserted, attempted, skipped }`.
- E5: `limit_eur: 300000000` → `400` (validation), `limit_eur: 500` → ok.
- E6: bootstrap с пустой/большой rates-таблицей → тот же ответ, один скан.

## 5. Data model

**Без изменений.** Никаких миграций/таблиц/колонок. Только код worker'а (handlers, db/budgets/rbar
сигнатуры, schemas Zod).

## 6. API contract

Формы ответов не меняются. Изменения поведения:
- `GET /v1/expenses|/v1/web/expenses|/v1/web/snapshots|/v1/web/incomes|/v1/web/transactions?limit=…`
  — невалидный `limit` → дефолт; слишком большой → `max`. (Раньше: 500/20000/1000/1000/1000 дефолты.)
- `POST /v1/admin/bulk-rates` — `400 { error }` при `items.length > MAX_BULK_RATES`; ответ получает
  поле `skipped` (кол-во пропущенных невалидных). Auth неизменно (`Bearer SYNC_TOKEN`).
- `POST/PUT /v1/web/budgets` — `limit_eur` сверх `.max` → `400` (Zod validation message).

## 7. UI / UX

Нет UI. (Косвенно: bytes/CPU bootstrap'а меньше; невалидный `limit` не роняет список.)

## 8. Security

- `parseLimit` дополнительно укрепляет границу: `?limit` уходит в SQL только как числовой bind после
  валидации (исключает `LIMIT NaN`-поведение и абсурдные выгрузки).
- `bulk-rates` cap — анти-DoS на системном эндпоинте (хотя он и так под `SYNC_TOKEN`).
- `limit_eur` cap — защита от мусорных значений в денежной модели.
- Auth-чеки всех затронутых эндпоинтов неизменны. Ничего нового в логи.

## 9. Acceptance criteria

- [x] AC1: `parseLimit("abc", 500, 20000) === 500`; `parseLimit("-1", …) === def`;
      `parseLimit("99999999", 500, 20000) === 20000`; `parseLimit("250", 500, 20000) === 250`.
- [x] AC2: Все 5 list-хендлеров используют `parseLimit` (нет голого `parseInt(... "limit")` в SQL-пути).
- [x] AC3: `bulk-rates` с `items.length > MAX_BULK_RATES` → `400`; валидные элементы вставляются,
      невалидные (нет date/quote, не-finite rate) пропускаются и считаются в `skipped`.
- [x] AC4: `budgetCreateSchema`/`budgetUpdateSchema` отвергают `limit_eur` сверх cap (Zod), принимают разумный.
- [x] AC5: `getBootstrapData` вызывает `loadRatesIndex` ровно 1 раз; `listExpenses`/`getBudgetsWithProgress`/
      `getEnvelopesForBootstrap`/`loadCommon` принимают опциональный `rates?: RatesIndex` и используют его.
- [x] AC6: Ответы bootstrap/списков идентичны прежним на валидных входах (форма + числа) — регресс-тест.
- [x] AC7: `tsc --noEmit` + `npm test` (worker) зелёные; новые unit-тесты на `parseLimit` и
      bulk-rates cap/skip; D1-mock тест, что bootstrap грузит rates 1× (spy/counter).
- [x] AC8: Admin/Mini App визуально не изменились (Playwright харнесы прежние, без новых ошибок).

## 10. Test plan

- **Worker vitest** (`cloud/worker`, `npm test`): `parseLimit` (AC1, таблица входов); `handleBulkRates`
  cap+skip на D1-mock (`node:sqlite`, как SPEC-022); регресс getBootstrapData/listExpenses формы; счётчик
  загрузок rates (обернуть/спайнуть `loadRatesIndex` или считать `SELECT … FROM rates` на mock-DB) = 1.
- **Schemas**: budget limit cap (parse валид/невалид).
- **Regression**: Admin Playwright (`test_admin_ui.py`) + Mini App (`test_miniapp_react.py`) — без изменений
  в выводе, 0 console-ошибок.
- **Review**: `solution-architect` (архитектура threading/типы/простота) + `senior-qa` (граничные limit,
  bulk edge, регресс bootstrap).

## 11. Risks & open questions

- R1: Threading `rates?` через 4 функции — следить, что все ВНУТРЕННИЕ загрузки в bootstrap-пути
  получают переданный индекс (иначе дедуп неполный). Тест-счётчик загрузок ловит это.
- R2: `max` для `parseLimit` — выбрать так, чтобы не обрезать легитимные выгрузки (single-user ~2000
  строк): `MAX_LIMIT = 20000` (как внутренний клам `listExpenses`).
- R3: `limit_eur .max` — не обрезать реальные бюджеты Stepan'а. Кап `1_000_000` EUR/мес — заведомо выше
  любого личного месячного лимита, но ловит лишние нули. Бамп тривиален.
- R4: `MAX_BULK_RATES` — backfill слал батчи 500; cap `5000` даёт headroom и режет абьюз.

## 12. Out of scope для review

- Keyset-пагинация (NG1), request-scoped кэш rates (NG2), дедуп expenses (NG3) — сознательно отложены.

## 13. Changelog spec'а

- 2026-06-27: создан в `in_progress` (owner выбрал worker-hardening батч тех-долга). Phase 1.
- 2026-06-27: Phase 2 — `parseLimit`+`MAX_LIST_LIMIT`/`MAX_BULK_RATES` (5 хендлеров), `handleBulkRates` cap+skip, `budgetLimit` (.max 1M), threading `rates?` (listExpenses/getBudgetsWithProgress/loadCommon/getEnvelopesForBootstrap) + 1× загрузка в getBootstrapData. 12 новых vitest (169/169). Миграций/schema нет. Тест поймал баг (пустой quote — строка проходит typeof) → ужесточён фильтр.
- 2026-06-27: Phase 3 — ревью: solution-architect = APPROVED_WITH_NICES, senior-qa = PASS (0 must-fix у обоих). Подтверждено: дедуп полный + per-request (нет утечки курсов между запросами, NG2), bootstrap байт-в-байт идентичен, все 5 limit-сайтов покрыты, bulk-rates строго надёжнее (500→counted skip). Закрыт общий nice-to-have: валидация формата `date` (ISO_DATE_RE) в bulk-rates фильтре. Отложено (known-limitation): коэрсинг `Number(rate)` от SYNC_TOKEN-клиента, последовательная загрузка rates перед Promise.all (latency-нейтрально для single-user).
