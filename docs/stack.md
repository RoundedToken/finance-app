# Технологический стек

> Актуально на Стадию 2 (после ADR-011 D1-pivot + SPEC-014 React-rewrite). До-pivot стек (Python local SQLite ground truth, outbox, vanilla Mini App, Excel-регенерация) — снят; Python остался только для backup и разовых импортов.

## Архитектура в одну строку

D1 (единственный источник правды) ← один Cloudflare Worker (TypeScript, REST + Telegram webhook + cron) → два React-SPA на Cloudflare Pages (Mini App + Web Admin). Всё на free tier, без VPS.

## Языки и рантаймы

| Компонент | Версия | Где |
|---|---|---|
| TypeScript | ~5.4–5.6 | Worker + оба фронта |
| Node.js | 22.5+ (`engines` в `cloud/worker/package.json`) | сборка (Vite) + деплой (wrangler) |
| Python | 3.13 (`.venv/`) | **только** backup D1 + разовые импорты + UI тест-харнесы. Системный 3.9.6 — не использовать |
| SQL (SQLite dialect) | — | `cloud/worker/migrations/`, `schema.sql` |

## Cloud Worker (`cloud/worker/`)

`package.json`: `wrangler ^3`, `@cloudflare/workers-types`, `typescript ^5`. **Без фреймворков** — vanilla `fetch` handler + ручной роутинг (никакого hono/express/orm). Серверная валидация payload — **Zod** (`schemas.ts` + `readBody`, SPEC-019): shape-валидация на мутирующих endpoint'ах, бизнес-правила (FK/кросс-поля) — в домене. Shared-контракт с Admin (admin импортирует схемы) — post-MVP.

## Mini App (`cloud/miniapp/`) — SPEC-014

React 19 + Vite 5 + TypeScript. TanStack Query. Tailwind + class-variance-authority + clsx + tailwind-merge. Telegram WebApp JS API (`telegram-web-app.js`), auth через `initData` HMAC. Scope: ввод расходов + read-only аналитика расходов (экран «📊 Статистика», ADR-021/SPEC-036; см. CLAUDE.md правило 11). Деплой: `vite build` → `wrangler pages deploy dist`.

## Web Admin (`cloud/admin/`)

React 19 + Vite + TypeScript. TanStack Router / Query / Table (**без** Form). Tailwind + CVA/clsx/tailwind-merge — UI hand-rolled (**без** Radix/shadcn/Tremor, вопреки исходному ADR-012; см. уточнение там). Графики/KPI — ECharts + echarts-for-react (vendored через `manualChunks`). Lucide-иконки. Деньги — `number` + `Intl`-форматирование (ADR-015), конверсия — на worker. Auth: Google OAuth → JWT HS256 → `Authorization: Bearer`.

> Сделано в Стадии 2: `dinero.js` и `date-fns` **удалены** (деньги — REAL/`Intl`, ADR-015; даты — нативные ISO-строки). `zod` **используется** — серверная валидация payload на worker (SPEC-019); shared-контракт worker↔admin — post-MVP.

## Облачные сервисы (Cloudflare free tier)

| Сервис | Лимит | Реальная нагрузка |
|---|---|---|
| Workers | 100k req/day, 10ms CPU | ~50/день |
| D1 | 5 GB, 5M reads/day, 100k writes/day | ~30 writes, ~2000 трат ≈ 250 KB |
| Pages | unlimited bandwidth, 500 deploys/мес | 1-2 deploy/мес (×2 проекта) |
| Cron Triggers | 1000/day | 1/день (курсы, `0 6 * * *`) |
| Telegram Bot API + Mini Apps | без лимитов для personal | — |
| Google Sheets (GOOGLEFINANCE → CSV) | — | прокси для курсов (ADR-006) |

Узкое место — только CPU 10ms на тяжёлых dashboard-агрегациях при многолетнем росте данных (осознанный отдалённый лимит, см. roadmap).

## Тестирование

- `local/scripts/test_admin_ui.py` — Playwright Web Admin (mock JWT + mock `/v1/**`, скриншоты light/dark).
- `local/scripts/test_miniapp_react.py` — Playwright Mini App React.
- `local/scripts/test_miniapp_ios.py` — Appium + iOS Simulator (реальная клавиатура iOS).
- Worker: `tsc --noEmit` + **vitest** (Стадия 2) на денежно-критичной логике (`RatesIndex`, реконструкция баланса).

## Локально (MacBook)

| Что | Назначение |
|---|---|
| `wrangler` | деплой Worker/Pages, `wrangler tail`, `wrangler d1 execute` |
| `local/scripts/backup_d1.py` | daily `wrangler d1 export` → iCloud (launchd) |
| `python` + `playwright`/`appium` | UI тест-харнесы |
| `gitleaks` | pre-commit secret-gate (`.githooks/pre-commit`) |

## Сознательно НЕ используется

PostgreSQL/MySQL, Redis, Docker/K8s, GraphQL, gRPC, Firebase/Supabase, AWS/GCP/Azure, любые VPS, PWA на iOS, native iOS (App Store). Обоснования — ADR-002/003/011/012. Vanilla JS для Mini App снят в пользу React (SPEC-014).
