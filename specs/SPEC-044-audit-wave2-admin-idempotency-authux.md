---
spec: SPEC-044
title: Волна 2 аудита (кластер 2 + часть 5) — Admin: идемпотентность create-мутаций и 401-UX
status: in_progress
created: 2026-07-07
owner: Stepan
---

# SPEC-044 · Волна 2 аудита — Admin idempotency + 401-UX

## 1. Context & Problem

Продолжение аудита 2026-07 (`docs/audits/2026-07-full-audit/`, мастер § Волна 2,
п.2 идемпотентность + п.5 ADM-03/08). Все находки — Web Admin (`cloud/admin/`);
worker не трогаем (сервер уже готов: `INSERT OR IGNORE`, create-схемы принимают
`id`). Полные описания — в отчёте 05.

| ID | Суть |
|---|---|
| ADM-02 | Admin не шлёт клиентский UUID в create — повторная отправка после сетевого таймаута создаёт дубликат (снапшот/доход/обмен → искажение балансов) |
| ADM-03 | Любой 401 (включая фоновый refetch) → `clearToken()` + жёсткий `window.location.href="/login"` — несохранённый ввод теряется, возврат всегда на `/` |
| ADM-08 | `isExpired` проверяется только в `beforeLoad` — долгоживущая вкладка гарантированно ловит жёсткий 401-редирект посреди работы |
| FIN-01-хвост | QA-ревью SPEC-042: edit-формы Income/Snapshot шлют полный payload со старым amount — смена счёта на другую валюту обходит серверный FIN-01-guard (guard срабатывает только при `amount == null`) |

## 2. Design (сжато)

- **ADM-02**: хук `useDraftId(active)` в `lib/utils.ts` — UUID генерится один раз
  на открытие формы, ретрай того же сабмита шлёт тот же `id` → дедуп на сервере.
  Подключён во все create-модалы: SnapshotModal, IncomeModal, GoalFormModal (create),
  ContributionModal, ExchangeModal, TransferModal, BuyModal, BalanceSnapshotModal,
  BudgetModal (оба create-режима), CategoryModal (create). `id` уходит **только**
  в create-payload, не в PUT. `SnapshotCreatePayload` дополнен `id?` (остальные типы уже имели).
- **ADM-03**: `apiFetch` при 401 больше не чистит токен и не перезагружает страницу —
  диспатчит `window.dispatchEvent(new CustomEvent("admin:session-expired"))` и бросает
  `ApiError(401)` (TanStack Query штатно помечает isError). AppLayout слушает событие
  и показывает несносимый модал «Сессия истекла» с единственной кнопкой «Войти»:
  по клику — сохранить `admin.return_to` (sessionStorage, pathname+search) →
  `clearToken()` → SPA-навигация на /login.
- **return_to**: LoginPage шлёт `origin + сохранённый path` (вместо hardcoded `/`);
  `beforeLoad` тоже сохраняет `location.href` перед redirect'ом на /login. Сервер
  валидирует только origin (`isAllowedReturnTo`) — path проходит как есть, OAuth
  redirect возвращает на исходную страницу. Использованный `admin.return_to`
  вычищается в `consumeFragmentToken()` после успешного логина.
- **ADM-08**: AppLayout при монтировании взводит таймер на `exp − now − 60с`
  (exp из `decodeClaims`); по срабатыванию — тот же модал, мягко, до фактического 401.
  `setTimeout` клампится в int32 (JWT живёт дольше 24.8 сут) с перевзводом.
- **FIN-01-хвост**: в edit-режиме SnapshotModal и IncomeModal выбор счёта с валютой,
  отличной от валюты редактируемой записи, очищает поле суммы и показывает подсказку
  «валюта сменилась на X — введи сумму заново» — пустая сумма блокирует сабмит,
  полный payload со старым amount больше не обходит серверный guard.
  Contribution: edit-формы взноса в Admin нет (создание+удаление) — нечего чинить.

## 3. Non-goals

- MA-01/WRK-16 (идемпотентность Mini App-клиента) — отдельный кластер.
- Auth-hardening SEC-06…10 (кластер 5, worker/miniapp-часть) — отдельный SPEC.
- Продление/refresh JWT, «тихий» re-login без участия пользователя.
- CRUD-редактор взносов в Admin (его нет — вне scope).

## 4. Acceptance criteria

- [x] AC1: каждый create-модал шлёт `id` (UUID), стабильный внутри одного открытия формы; повторное открытие формы → новый `id`; PUT-патчи `id` не содержат.
- [x] AC2: 401 от не-`/v1/auth/*` запроса не перезагружает страницу и не чистит токен; диспатчится `admin:session-expired`; запрос завершается `ApiError(401)`.
- [x] AC3: AppLayout по событию показывает несносимый модал (без Escape/backdrop-close); кнопка «Войти» → clearToken + навигация на /login с сохранением return_to.
- [x] AC4: после логина пользователь возвращается на страницу, с которой его выкинуло (path в return_to; origin-allowlist сервера не задет).
- [x] AC5: на смонтированном AppLayout модал появляется за ~60с до `exp` без единого 401.
- [x] AC6: в edit Income/Snapshot смена счёта на другую валюту очищает сумму, показывает подсказку и блокирует сабмит до ввода новой суммы; возврат валюты записи убирает подсказку.
- [x] AC7: `tsc --noEmit` чисто, `npm run build` зелёный.

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в этой же сессии (волна 2, автономный режим по owner-решению). AC отмечены по факту реализации + `tsc`/`build`; Playwright-прогон (light/dark) — на стороне оркестратора волны перед merge/deploy.
