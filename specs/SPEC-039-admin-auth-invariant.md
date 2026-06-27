---
id: SPEC-039
title: Admin auth invariant — единый guard на /v1/web/* (post-mvp 2.7, часть 1)
status: done
owner: stepan
created: 2026-06-27
updated: 2026-06-27
links:
  - parent: review-mvp-stage1   # post-mvp 2.7 (Batch E хвост)
  - depends_on: [SPEC-004]       # Google OAuth → JWT → requireAdminSession
---

# Admin auth invariant — единый guard на /v1/web/*

## 1. Context & Problem

Каждый из **41** Admin-хендлеров в `index.ts` начинается с одинаковых двух строк:

```ts
const session = await requireAdminSession(request, env);
if (!session.ok) return session.response;
```

Это копипаст-инвариант: добавил новый `/v1/web/*` хендлер и **забыл guard** → endpoint
доступен без авторизации (security-footгана). 169 vitest и Playwright-харнес это не ловят
(тестируют доменные функции / мокают `/v1/**`). Все `/v1/web/*` без исключения требуют
admin-сессию (Google OAuth → JWT HS256 → allowlist email), а `/v1/admin/*` — отдельный
`SYNC_TOKEN`. Значит guard можно поднять на **префикс роутера** и сделать структурным
инвариантом: один чек на `/v1/web/`, хендлеры чистые.

(Вторая половина roadmap-2.7 — «shared Zod-контракт worker↔admin» — оценена и **отложена**,
см. NG1: низкий ROI для single-user.)

## 2. Goals

- G1: Один admin-guard на префиксе `/v1/web/` в `fetch`-роутере: `requireAdminSession`
  вызывается **один раз**; при `!ok` → его `response` (401/403/500). Любой `/v1/web/*`
  (включая будущий) автоматически защищён.
- G2: Убрать 41 копию 2-строчного guard'а из Admin-хендлеров — они становятся «чистыми»
  (только бизнес-логика). `requireAdminSession` остаётся одной точкой (в роутере).
- G3: `/v1/web/me` (единственный, кто использует `session.email`) — заинлайнен в guard-блок
  (берёт уже проверенную сессию), `handleAdminMe` больше не дублирует чек.
- G4: Поведение неизменно: те же коды (401 без/с битым Bearer, 403 не-allowlist email,
  200 валидный) и те же ответы хендлеров. Это рефактор, не смена контракта.
- G5: **Тесты инварианта** (через `worker.fetch`): репрезентативные `/v1/web/*` отвергают
  без Bearer (401) и пускают с валидным JWT (200/нужный код) — фиксируют, что guard на месте.

## 3. Non-Goals

- NG1: **Shared Zod-контракт worker↔admin** (вторая половина 2.7) — отложено. Причины: (1)
  нет monorepo-workspace, worker и admin — раздельные пакеты с раздельными билдами (vite/wrangler);
  cross-package import worker-схем в admin brittle (admin-vite потянет worker-граф). (2) worker
  Zod-схемы — это **request-payload** валидация (create/update); response-типы admin'а
  (`Goal`/`Account`/`Dashboard`, ~53 из 63) в worker НЕ Zod → `z.infer` покрыл бы лишь ~10
  payload-типов. ROI низкий для single-user. Если понадобится — отдельный спек с workspace-решением.
- NG2: Обёртка для Mini App `authenticateMiniApp` (7 сайтов, `/v1/*`). Тот же приём применим, но
  Mini App-эндпоинты разнородны по auth (initData), вне scope этого пункта 2.7 (про Admin).
- NG3: Изменение `/v1/admin/*` (SYNC_TOKEN) — другой guard, не трогаем.
- NG4: Смена самого `requireAdminSession` / JWT-логики (SPEC-004) — переиспользуем как есть.
- NG5: Переписывание роутера в декларативную таблицу маршрутов — оставляем if-chain, добавляем
  только префикс-guard (минимальная, безопасная дельта на auth-критичном коде).

## 4. User journeys

Внешнего UX нет. Наблюдаемое поведение неизменно:

### Happy path
1. Admin с валидным JWT → все `/v1/web/*` работают как раньше.
2. Запрос без/с битым токеном → 401; токен не-allowlist email → 403 (как раньше).

### Edge cases
- E1: Новый `/v1/web/*` хендлер добавлен без явного guard → **всё равно защищён** (префикс).
- E2: `/v1/web/<unknown>` с валидной сессией → 404 (после auth).
- E3: `/v1/web/me` → 200 `{ ok, email }` из проверенной сессии.
- E4: `/v1/admin/*` и Mini App `/v1/*` — guard не затронут (другие auth-каналы).

## 5. Data model

**Без изменений.** Только control-flow в `index.ts` (+ удаление неиспользуемого `handleAdminMe`).

## 6. API contract

Контракт неизменен. Те же статусы и тела:
- `/v1/web/*` без/с битым Bearer → `401 { error: "unauthorized" }`.
- не-allowlist email → `403 { error: "forbidden" }`.
- `ADMIN_JWT_SECRET` не задан → `500 { error: "server misconfigured" }`.
- `/v1/web/me` → `200 { ok: true, email }`.
- Прочие `/v1/web/*` — те же ответы хендлеров.

## 7. UI / UX

Нет UI.

## 8. Security

- **Усиление**: guard становится структурным инвариантом — нельзя забыть авторизацию на новом
  `/v1/web/*` (E1). Это и есть цель.
- Поведение auth идентично (те же 401/403/500). Allowlist email (`ADMIN_ALLOWED_EMAILS`) и JWT-проверка
  (`ADMIN_JWT_SECRET`) — без изменений.
- `/v1/admin/*` (SYNC_TOKEN) и Mini App initData — не затронуты.
- Ничего нового в логи.

## 9. Acceptance criteria

- [x] AC1: В `index.ts` ровно **один** `requireAdminSession`-вызов в `fetch`-роутере (префикс
      `/v1/web/`); в Admin-хендлерах вызовов guard'а **нет** (grep).
- [x] AC2: `GET /v1/web/<any>` без `Authorization` → 401; с `Bearer <битый>` → 401.
- [x] AC3: `GET /v1/web/me` с валидным JWT (allowlist email) → 200 `{ ok, email }`.
- [x] AC4: `GET /v1/web/expenses` (репрезентативный) с валидным JWT → не-401 (проходит guard);
      без — 401.
- [x] AC5: Не-allowlist email в валидном JWT → 403 на `/v1/web/*`.
- [x] AC6: `handleAdminMe` удалён/не импортируется (нет dead-code, tsc чист по unused).
- [x] AC7: `/v1/admin/bulk-rates` (SYNC_TOKEN) и `/v1/bootstrap` (initData) — поведение auth
      неизменно (регресс).
- [x] AC8: `tsc --noEmit` + `npm test` зелёные; новые auth-тесты на инвариант; 169 прежних — зелёные.

## 10. Test plan

- **Worker vitest** (`worker.fetch` + d1-mock + `signJwt`): 401 без Bearer на нескольких `/v1/web/*`
  (GET/POST/PUT/DELETE-представители), 200 на `/v1/web/me` с валидным JWT, 403 на не-allowlist,
  500 при отсутствии `ADMIN_JWT_SECRET`; регресс — `/v1/admin/bulk-rates` 401 без SYNC_TOKEN.
- **Regression**: 169 прежних vitest; Admin Playwright (`test_admin_ui.py`) — мокает `/v1/**`, поведение
  фронта неизменно (0 console-ошибок) — sanity, не основной гейт.
- **Review**: `solution-architect` (control-flow корректность, что НИ ОДИН `/v1/web/*` не остался без
  guard, dead-code) + `senior-qa` (матрица auth-кодов, edge E1-E4, регресс других каналов).

## 11. Risks & open questions

- R1: Главный риск — `/v1/web/*` маршрут, который окажется ВНЕ префикс-guard (рассинхрон). Митигация:
  guard стоит до всего `/v1/web` if-chain; тест «случайный `/v1/web/x` без токена → 401» ловит дыру.
- R2: `/v1/web/<unknown>` теперь требует auth перед 404 (раньше — тоже, т.к. не матчился и падал в
  общий 404 без auth). Незначительное ужесточение (404→401 для неизвестного web-пути без токена) —
  приемлемо/желательно (не раскрываем существование путей до auth).
- R3: Удаление 41 guard-пар скриптом — проверить, что паттерн единообразен (41× точное совпадение) и
  ни один хендлер не использовал `session` (проверено: только `handleAdminMe`).

## 12. Out of scope для review

- Shared Zod-контракт (NG1), Mini App-обёртка (NG2), декларативный роутер (NG5) — сознательно отложены.

## 13. Changelog spec'а

- 2026-06-27: создан в `in_progress` (продолжение тех-долга: 2.7 часть 1 — auth-инвариант). Phase 1.
- 2026-06-27: Phase 2 — префикс-guard `if (path.startsWith("/v1/web/"))` в роутере (1 `requireAdminSession`), убраны 41 guard-пара из хендлеров, `/v1/web/me` заинлайнен, `handleAdminMe` удалён. −77 строк. 12 новых auth-тестов через `worker.fetch`+`signJwt` (181/181). Без миграций/schema.
- 2026-06-27: Phase 3 — ревью: solution-architect = APPROVED, senior-qa = PASS (0 must-fix у обоих). QA исчерпывающе доказал: все 27 `/v1/web`-маршрутов ниже guard'а (ни одного непокрытого), полная auth-матрица (401/403/500/200), cross-channel изоляция (admin-JWT не проходит на SYNC_TOKEN/initData каналы), adversarial path-matching. Arch: префикс-guard сильнее HOF (новый хендлер защищён по умолчанию). Добавлен прямой E2-тест (valid session + unknown → 404). Известное (документировано, не блокер): инвариант позиционный — guard должен стоять выше web-строк (полное решение = декларативный route-table, NG5/tech-debt).
