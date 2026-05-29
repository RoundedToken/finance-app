---
id: SPEC-019
title: Серверная валидация payload через Zod (закрытие Batch E)
status: done
owner: stepan
created: 2026-05-29
updated: 2026-05-29
links:
  - adr: docs/decisions.md#adr-012
  - review: docs/review-mvp-stage1.md
  - parent: docs/process.md
---

## 1. Context

Ревью Стадии 1 (`docs/review-mvp-stage1.md`, находки stack/security) зафиксировало: на worker нет единого слоя валидации payload — часть мутирующих endpoint'ов при отсутствии required-полей или неверном типе роняла запрос в D1-constraint / `500` вместо осмысленного `400`. ADR-012 декларировал Zod, но он не использовался (удалён из admin как мёртвый в Batch B; на worker внедряем по-настоящему). Это последний содержательный пункт Batch E перед финализацией MVP.

## 2. Goals

- G1: Единый слой shape-валидации на worker — `cloud/worker/src/schemas.ts` (Zod) + хелпер `readBody(request, env, schema)`.
- G2: Все мутирующие endpoint'ы (`POST`/`PUT` expenses, incomes, snapshots, transactions, goals, goal-contributions, categories, goal status) валидируют shape ДО доменной логики → `400 {error}` с понятным сообщением вместо `500`/DB-ошибки.
- G3: Доменные функции (FK-проверки, бизнес-инварианты, требующие D1) остаются — Zod покрывает только shape (типы, required, enum, положительность сумм, формат даты). Без дублирования бизнес-правил (hex-цвет, обязательность target_currency, FK) — они в домене.
- G4: Типобезопасность — `z.infer` где удобно; убрать часть `as any` в хендлерах.

## 3. Non-Goals

- NG1: Shared-контракт worker↔admin (admin импортирует схемы worker) — требует monorepo-tooling, отдельная задача post-MVP. Admin-типы остаются ручными.
- NG2: `withAdminSession`/`parseJsonBody`-обёртки на все хендлеры — DX-рефактор, guard'ы и так все на месте (проверено ревью), отложено post-MVP.
- NG3: Aggregator против двойного `loadRatesIndex` — perf, single-user не критично, отложено.

## 4. Acceptance

- AC1: `POST /v1/web/incomes` без `amount` → `400 {error}` (не 500).
- AC2: `POST /v1/web/transactions` с `type:"foo"` → `400` (enum).
- AC3: `POST /v1/expenses` (Mini App) с валидным payload → `200` как раньше; с `amount:"x"` → `400`.
- AC4: `POST /v1/web/goal-contributions` без `account_id` → `400` (L4).
- AC5: Валидные payload'ы всех существующих потоков работают без регрессий (typecheck + vitest + UI-харнесы).
- AC6: Тело `400` не содержит stack-trace / internal (только сообщение Zod / domain).

## 5. Changelog

- 2026-05-29: SPEC создан в рамках автономного завершения Стадии 2 (Batch E). Zod внедрён на worker (`schemas.ts` + `readBody`), 17 мутирующих хендлеров провалидированы; `schemas.test.ts` (14 тестов, всего 42 зелёных), typecheck чист.
- **Phase 3 gate: `pass` по всем 3 линзам** (регрессии / покрытие / shape-vs-домен), 18 notes, 0 находок ≥ low. Регрессий нет — 22 реальных payload'а клиентов проиграны против схем без ложных reject'ов. Pre-existing backlog (не регрессия): `snapshot.account_id` не проверяется на FK ни Zod, ни доменом (admin шлёт валидный id из дропдауна — практический риск ~0).
