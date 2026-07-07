---
spec: SPEC-043
title: Волна 2 аудита (кластеры 1+3+4) — worker hardening: null-семантика PUT, валидация периметра, legacy-код
status: in_progress
created: 2026-07-07
owner: Stepan
---

# SPEC-043 · Волна 2 аудита — worker hardening

## 1. Context & Problem

Продолжение аудита 2026-07 (`docs/audits/2026-07-full-audit/`, мастер § Волна 2,
кластеры 1, 3, 4). Все находки — worker; объединены в один SPEC/ветку по процессу
аудита (п.5). Полные описания — в отчёте 02 (+DB-03 в 08).

| ID | Кластер | Суть |
|---|---|---|
| WRK-05 | 1 | updateSnapshot: частичный PUT стирает note (нет hasOwnProperty-гарда) |
| WRK-06 | 1 | updateGoal: merged собирался из patch+name — частичный PUT падал ложным 400 «target_currency is required» |
| WRK-07 | 1 | updateExpense без overdraft-гарда — create-гард L1 обходился правкой суммы |
| WRK-14 | 1 | updateTransaction: fee-only патч обходил validateStep и overdraft |
| WRK-03 | 3 | Zod пропускает Infinity (`1e309`) в суммы — отравление всех агрегатов |
| WRK-17 | 3 | ISO-даты только regex — `2026-13-99` проходит во все date-поля и `?today=` |
| WRK-04 | 3 | parseLatestCsv не валидирует дату CSV — мусор необратимо портит MAX(date) |
| WRK-15 | 3 | /v1/admin/migrate-expenses без cap и per-item валидации (мусор → 500/порча) |
| WRK-13 | 3 | coach-нудж не экранирует имена в HTML — Telegram 400, cron падает ежедневно |
| WRK-19 (FIN-02, DB-05) | 4 | replaceReferences: DELETE справочников + reinsert — теряет deleted_at/поля, несовместим с FK-энфорсом |
| DB-03 | 4 | createExpense принимает несуществующие account_id/category_id — сироты создаваемы |

## 2. Design (сжато)

- **WRK-05**: `note = ${hasNote ? "?" : "note"}` в updateSnapshot (паттерн соседних доменов).
- **WRK-06**: `merged = { ...полная строка из loadGoalRow, ...patch }`; несуществующая цель → 400 «goal not found».
- **WRK-07**: в updateExpense общий guard-блок по результирующим значениям (валюта/инвест/exists/overdraft); откат старой версии траты по образцу `checkOverdraft(excludeTxId)`; правка только note не делает SELECT.
- **WRK-14**: fee_amount/fee_currency включены в `wantsStructural` → validateStep(merged) + overdraft.
- **WRK-03**: `posAmount = positive().finite().max(1e12)`; `moneyValue` (снапшот, знак любой, |x|≤1e12); `nonNegAmount` для fee/floor/reco.
- **WRK-17**: `isRealIsoDate()` (реальность календарного дня) в Zod `isoDate`, `resolveToday`, фильтре bulk-rates.
- **WRK-04**: parseLatestCsv кидает `bad date` при не-ISO — cron изолирован, остаётся вчерашний курс.
- **WRK-15**: cap 5000 + per-item shape-фильтр в handleMigrate; ответ с `skipped_invalid`/`skipped_overflow`.
- **WRK-13**: `escapeHtml` экспортирован из bot.ts (+ `"`/`'`), применён ко всем подставляемым именам в coach.ts.
- **WRK-19**: endpoint `/v1/admin/references` и `replaceReferences` удалены (миграция давно выполнена; справочники — SPEC-017 CRUD + миграции).
- **DB-03**: exists-guard'ы account_id/category_id в create/updateExpense → 400 `unknown …`. ⚠ Осознанная смена поведения SPEC-032-эпохи «несуществующее ведро не блокируем» — клиенты шлют id из bootstrap-справочника, опечатка = тихая потеря записи из баланса.

## 3. Non-goals

- Идемпотентность Admin-клиента (кластер 2), auth-hardening (кластер 5), тестовый пояс QA-02+ (кластер 6), данные/миграции (кластер 7), доки (кластер 8) — следующие SPEC'и/PR волны 2.
- FK на expenses через rebuild-миграцию (DB-02-опция) — не делаем, серверные guard'ы достаточны.

## 4. Acceptance criteria

- [x] AC1: PUT snapshot `{amount}` не стирает note; `{note: null}` стирает (тест).
- [x] AC2: PUT goal `{note}` на цель с заданной валютой → 200; несуществующая цель → 400 (тест).
- [x] AC3: правка суммы траты сверх баланса → 400 «недостаточно средств»; в пределах (с откатом старой версии) → ok (тест).
- [x] AC4: PUT transaction `{fee_currency:"ZZZ"}` → 400; `{fee_amount}` без валюты → 400; валидная пара — ok с overdraft (тест).
- [x] AC5: `Infinity`/`1e309`/`>1e12` в суммах и `2026-13-99` в датах режутся Zod'ом (тест).
- [x] AC6: parseLatestCsv с не-ISO датой кидает исключение (тест).
- [x] AC7: `/v1/admin/references` → 404; migrate-expenses скипает мусор и отвечает счётчиками (тест через worker.fetch).
- [x] AC8: createExpense/updateExpense с несуществующим account_id/category_id → 400 (тест; старый тест «не блокируем» обновлён осознанно).
- [x] AC9: escapeHtml экранирует `& < > " '`; имена в coach-нуджах проходят через него (тест + код).
- [x] AC10: полный vitest зелёный, tsc чист.

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в этой же сессии (волна 2, автономный режим по owner-решению).
