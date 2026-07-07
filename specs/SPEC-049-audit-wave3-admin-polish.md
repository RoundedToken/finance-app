---
spec: SPEC-049
title: Волна 3 аудита — P3-полировка Web Admin + доки P3
status: done
created: 2026-07-07
owner: Stepan
---

# SPEC-049 · Волна 3 аудита — P3-полировка Web Admin (ADM) + доки P3 (DOC)

## 1. Context & Problem

Продолжение аудита 2026-07 (мастер § Волна 3). Волны 1–2 закрыли P1/P2-ядро
(SPEC-042…046). Здесь — оставшиеся находки Admin UI (P2 ADM-04/05/06 + P3
ADM-09…22, кроме уже закрытого ADM-16) и доки P3 (DOC-21…28) из
`docs/audits/2026-07-full-audit/05-admin-ui.md` и `09-docs-consistency.md`.

## 2. Решения по находкам

### Admin UI (05-admin-ui.md)

| ID | Решение | Что сделано / почему нет |
|---|---|---|
| ADM-04 P2 | **FIX** | PeriodPicker: месяц считается от 1-го числа — `setMonth` от 29–31 числа переполнялся, ‹prev› возвращал тот же месяц. |
| ADM-05 P2 | **FIX** (приоритет) | CategoriesPage и GoalDetailPage: ветка `isError → ErrorState(Retry)` — 5xx больше не маскируется под «категорий нет»/«цель не найдена». |
| ADM-06 P2 | **FIX** | Donut: fallback-цвет один раз по полному списку (`colorOf` Map) — сектор и легенда всегда одного цвета при активном фильтре. |
| ADM-09 P3 | **FIX частично + DEFER** | `color-scheme: dark` — светлые нативные контролы (календарь, scrollbar) больше не вылезают на тёмный UI. Light-палитра оставлена (её использует тест-харнес); полноценный theme-toggle — отдельное owner-решение. |
| ADM-10 P3 | **FIX** | `/snapshots` читает `?account_id=` (validateSearch в routeTree, фильтр применяется), `as any` в Link убран. |
| ADM-11 P3 | **FIX частично + DEFER** | Modal: focus trap (Tab циклится, фокус входит в модал и возвращается на триггер), `aria-labelledby`. Dirty-confirm при закрытии — DEFER: требует прокинуть dirty-флаг из всех 12 форм, а главный канал потери ввода (401) уже закрыт SPEC-044. |
| ADM-12 P3 | **FIX** | Спарклайн из карточки Runway убран — рисовал ряд net worth, не runway (смешение метрик, memory `kpi-card-one-signal`); Δ-бейджа достаточно. |
| ADM-13 P3 | **DEFER** | Валидация форм (inline-подсказки, капы, запятая, границы дат) — M-объём × 12 форм + продуктовые решения (allow-future, капы per-domain) — отдельная спека, не попутная правка. |
| ADM-14 P3 | **FIX** | SnapshotModal: `useMemo`→`useEffect` (паттерн выровнен с остальными модалами), дефолт ведра после загрузки accounts + честный плейсхолдер «— выбери ведро —». |
| ADM-15 P3 | **DEFER** | Дедупликация Field/pluralize/MON/compact/KpiCard — механический рефактор ×10 файлов без видимого поведения; отдельный заход с прогоном харнеса (частично уже в roadmap: SPEC-006 N5). |
| ADM-17 P3 | **DEFER** | ECharts-чанк лениво — уже в roadmap tech debt [известно, SPEC-013]; выигрыш ограничен /login (после логина дашборд всё равно тянет ECharts), lazy-обёртка требует отдельной визуальной проверки Suspense-состояний. |
| ADM-18 P3 | **FIX** | `formatDate` форматирует строку без `new Date("YYYY-MM-DD")` (UTC-полночь) — дата не съезжает на −1 день в западных TZ. |
| ADM-19 P3 | **FIX** | Удаление бюджета — с `confirm` (был единственный delete без него); строчные delete-кнопки (Snapshots/Incomes/Transactions/GoalDetail-взносы) — `disabled` пока DELETE в полёте. |
| ADM-20 P3 | **FIX guard + DEFER endpoint** | Стрелки reorder категорий неактивны пока пара PUT свопа в полёте. Серверный `PUT /categories/reorder` (атомарная транзакция) — DEFER: M, отдельный worker-заход. |
| ADM-21 P3 | **FIX частично + DEFER** | `aria-pressed` на легенде donut и чипах FormFilter; Toast ошибок — `role="alert"`. Стрелочная навигация в goal-меню и мобильный layout — DEFER (desktop-first — осознанное owner-решение, зафиксировано в аудите). |
| ADM-22 P3 | **FIX** | `refetchOnWindowFocus: true` — сценарий «трата с iPhone → вкладка Admin на маке» получает свежие данные по возврату во вкладку (single-user, запросы дешёвые). |

### Доки (09-docs-consistency.md)

| ID | Решение | Что сделано / почему нет |
|---|---|---|
| DOC-21 | **FIX** | Деревья CLAUDE.md: docs/ — все 12 файлов; local/ — полный scripts (backfill_crypto_rates, prod_smoke, legacy init_db/migrate_to_d1) + migrations/schema.sql (legacy) + screenshots/; admin src — `App.tsx`-фантом заменён на `routeTree.tsx` + `lib/`. |
| DOC-22 | **FIX** | roadmap: «10 audits» → 16 (SPEC-001…008 × arch+qa); заголовки Stage 2/3 несут SPEC-002/SPEC-003; post-mvp: висячее «1.5 — как только дашь RSD-суммы» заменено на «ОТМЕНЕНО». |
| DOC-23 | **FIX (а) + WONTFIX (б)** | (а) оба крона (`0 6` курсы + `0 7` coach) в stack.md и cloud/README.md. (б) wrangler в devDeps admin/miniapp — WONTFIX: глобальная установка — осознанный setup (docs/setup.md, правило 8 CLAUDE.md), дублировать тяжёлую dev-зависимость в двух Pages-пакетах не нужно. |
| DOC-24 | **FIX** | setup.md: рудимент `GOOGLE_RATES_CSV_URL` заменён на реальные `GOOGLE_RATES_LATEST_CSV`/`GOOGLE_RATES_HISTORY_CSV`. |
| DOC-25 | **FIX** | data-model.md: фраза-уточнение — обязательность `goal_contributions.account_id` app-level (DDL nullable, энфорс в `goals.ts`). |
| DOC-26 | **FIX частично + DEFER** | Номер ADR-019 проставлен в «отдельном решении» ADR-018. Шапки Status/Date у всех 23 ADR — DEFER: датная археология по git-истории, отдельный механический заход (лучше скриптом). |
| DOC-27 | **FIX** | `backfill_crypto_rates.py` добавлен в таблицу local/README.md. |
| DOC-28 | **FIX** | Пометка у M1 в specs/audits/SPEC-008-qa.md: скоуп chains откачен SPEC-012, находка историческая. |

## 3. Non-goals

- Theme-toggle / удаление light-палитры (ADM-09) — owner-решение.
- Dirty-check модалов (ADM-11), клиентская валидация форм (ADM-13), дедупликация
  кода (ADM-15), lazy ECharts (ADM-17), серверный reorder (ADM-20), мобильный
  layout (ADM-21) — зафиксированы как DEFER, не входят в волну.
- ADM-01/02/03/07/08/16 — закрыты ранее (SPEC-042/043/044).

## 4. Acceptance criteria

- [x] AC1: `computeRange({type:"month", offset:-1})` от 29–31 числа возвращает предыдущий месяц (проверено на `new Date(2026,4,31)`).
- [x] AC2: mock-5xx на `/v1/web/categories` и `/v1/web/goals/:id` → ErrorState с Retry, не empty-state.
- [x] AC3: при фильтре легенды категория без явного `color` — один цвет в секторе и легенде.
- [x] AC4: Tab в открытом модале циклится внутри карточки; Escape закрывает; фокус возвращается на триггер.
- [x] AC5: карточка Runway без спарклайна, Δ-бейдж на месте.
- [x] AC6: клик по ведру на /accounts → /snapshots с применённым фильтром этого ведра.
- [x] AC7: `cd cloud/admin && npx tsc --noEmit` чист, `npm run build` зелёный.
- [x] AC8: отметки (✅ FIXED / ⏸ DEFER / WONTFIX) проставлены в 05-admin-ui.md и 09-docs-consistency.md.

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в worktree-сессии волны 3 (ветка `fix/audit-wave3-admin`, без push — merge/deploy у оркестратора).
- 2026-07-07: `done` — PR #35 (`15fba6d`) смержен, задеплоено на прод (Pages), харнесы light+dark зелёные, скриншоты просмотрены (Runway без спарклайна, бейджи при disabled-гриде, Δ-подпись).
