---
spec: SPEC-045
title: Волна 2 аудита (кластеры 5+7) — auth-hardening и гигиена данных
status: done
created: 2026-07-07
owner: Stepan
---

# SPEC-045 · Волна 2 аудита — auth-hardening (кластер 5) + данные (кластер 7)

## 1. Context & Problem

Продолжение аудита 2026-07 (мастер § Волна 2, п.5 и п.7). ADM-03/08 из п.5 уже
закрыты SPEC-044. Здесь — worker/miniapp/admin-части.

| ID | Кластер | Суть |
|---|---|---|
| SEC-06 | 5 | initData без проверки `auth_date` — неограниченный replay утёкшей строки |
| SEC-07 | 5 | Сравнение HMAC/JWT/SYNC_TOKEN обычным `===` — timing side-channel |
| SEC-08 | 5 | 30-дневный JWT в localStorage без отзыва — широкое окно украденному токену |
| SEC-09 | 5 | echarts < 6.1.0 — XSS-advisory (единственная prod-уязвимость npm) |
| SEC-10 | 5 | Mini App без CSP/security-заголовков |
| DB-04 | 7 | d1_migrations рассинхронизирован (0001–0005) — `migrations apply` = рулетка |
| DB-09 (SPC-09, FIN-04) | 7 | 220 строк snapshots/incomes в T-формате created_at против канона |
| SPC-06 (MA-14) | 7 | Тихий потолок 5000 трат в Mini App (История/Статистика «Всё») |

## 2. Design

- **SEC-06**: `validateInitData` требует `auth_date` и отклоняет старше 24ч (подписан Telegram'ом — только replay, не подделка). Telegram обновляет initData при каждом открытии Mini App.
- **SEC-07**: общий `timingSafeEqualStr` (XOR-аккумулятор) в auth.ts; применён к initData-hash, JWT-подписи, SYNC_TOKEN bearer (webhook-секрет уже был timing-safe с SPEC-042).
- **SEC-08**: `SESSION_TTL_SECONDS` 30д → **72ч**; новый `POST /v1/web/session/refresh` (внутри префикс-гарда) выдаёт свежий токен; Admin AppLayout при остатке < TTL/2 молча продлевает (раз в час + на mount). Активный пользователь не разлогинивается; украденный токен умирает ≤72ч. Пересмотр ADR-012 (отметить в decisions.md — кластер 8/волна 3).
- **SEC-09**: `echarts ^5.5.1 → ^6.1.0` в admin. `npm audit --omit=dev` = 0. Дашборд визуально проверен харнесом (линии/пунктир/спарклайны целы).
- **SEC-10**: `cloud/miniapp/public/_headers`: nosniff, Referrer-Policy, Permissions-Policy, CSP (`script-src 'self' https://telegram.org`, `connect-src 'self' __WORKER_ORIGIN__`, БЕЗ `frame-ancestors 'none'` — Telegram фреймит Mini App). Placeholder + vite-плагин inject (паттерн admin).
- **DB-04**: backfill точных имён 0006–0018 в `d1_migrations` (прод, после бэкапа), затем штатный `wrangler d1 migrations apply` применил 0019 — инструмент вылечен; memory обновлена.
- **DB-09**: миграция `0019_normalize_snapshots_incomes_created_at.sql` (T→' ', срез до 19 симв., snapshots+incomes, created_at+updated_at). Безопасность доказана дифф-анализом на копии прода: effective_balance всех вёдер × 36 месячных срезов — 0 расхождений. Применена на прод: 0 строк T-формата, counts/суммы целы.
- **SPC-06**: Mini App `useExpenses` limit 5000 → 20000 (симметрия с bootstrap и server-cap).

## 3. Non-goals

- SEC-11…15 (P3) — волна 3. Серверный список отзыва JWT — не нужен при 72ч+refresh.
- Кластер 6 (тестовый пояс QA-02…10) — отдельный заход.

## 4. Acceptance criteria

- [x] AC1: initData старше 24ч → 401 `initData expired`; свежий → ok; битый hash → reject (тест с самоподписанным initData).
- [x] AC2: `timingSafeEqualStr` — равные/неравные/разной длины; verifyJwt не регрессировал (тесты).
- [x] AC3: `POST /v1/web/session/refresh` с валидным JWT → свежий токен ttl=72ч; без JWT → 401 (тест).
- [x] AC4: `npm audit --omit=dev` в admin = 0 уязвимостей; дашборд рендерится (скриншот-харнес).
- [x] AC5: `dist/_headers` Mini App содержит CSP с реальным origin (build-inject проверен).
- [x] AC6: `d1_migrations` = 18 точных имён + 0019 применена штатным `migrations apply`; прод: 0 T-строк, 218/54 строк целы (проверено).
- [x] AC7: дифф-анализ балансов до/после 0019 на копии — 0 расхождений (36 срезов × все вёдра).
- [x] AC8: miniapp limit=20000; vitest 254/254; tsc чист ×3.

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в сессии аудита (автономный режим). Прод-операции DB-04/DB-09 выполнены до merge ветки (бэкап взят, анализ приложен) — файл миграции 0019 едет в репо этим же PR.
- 2026-07-07: Phase 3: qa=PASS_WITH_NICES, arch=APPROVED_WITH_NICES; must-fix (data-model/ADR-012) закрыты, применены nices: absolute cap 30д на refresh-цепочку (auth_time), CSP base-uri/form-action/object-src ×2, подсказка про протухший initData. `done` — PR #33 (`cd27483`), worker+miniapp+admin задеплоены, ADMIN_JWT_SECRET ротирован (старые 30-дневные токены погашены), прод-smoke: CSP Mini App отдаётся, refresh 401 без auth, healthz 200. 256/256.
