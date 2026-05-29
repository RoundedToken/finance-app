# cloud — Cloudflare Worker + два React-клиента

Облачная часть системы. **Не VPS** — serverless на Cloudflare (Workers + D1 + Pages), деплой через `wrangler`. **D1 — единственный источник правды** (ADR-011).

## Структура

```
cloud/
├── worker/                     ← Cloudflare Worker (TypeScript) — единственный API
│   ├── src/
│   │   ├── index.ts            ← fetch-роутер + cron (курсы) + middleware
│   │   ├── auth.ts             ← Telegram initData HMAC + checkBearer
│   │   ├── auth-google.ts      ← Google OAuth → JWT, requireAdminSession
│   │   ├── jwt.ts              ← HS256 sign/verify (Web Crypto)
│   │   ├── db.ts               ← expenses CRUD + bootstrap
│   │   ├── snapshots.ts        ← getEffectiveBalance (SPEC-011), buckets
│   │   ├── incomes.ts, goals.ts, transactions.ts, categories.ts
│   │   ├── dashboard.ts        ← агрегированный дашборд (SPEC-013/015/018)
│   │   ├── rates.ts            ← RatesIndex (ADR-014), фетч курсов (ADR-006)
│   │   ├── ledger.ts           ← чистое денежное ядро (reconstructBalance, fee, round)
│   │   ├── schemas.ts          ← Zod-валидация payload (SPEC-019)
│   │   ├── bot.ts, cors.ts, types.ts
│   │   ├── schema.sql, migrations/0001..0010
│   │   ├── wrangler.toml (gitignored), wrangler.example.toml
│   │   └── package.json (tsc + vitest)
├── miniapp/                    ← Telegram Mini App (React 19 + Vite, SPEC-014) — ТОЛЬКО ввод расходов
│   └── src/ (screens, components, api, lib)
└── admin/                      ← Web Admin (React 19 + Vite + TanStack + ECharts) — снапшоты/доходы/цели/обмены/дашборд/аналитика
    └── src/ (routes, components, api, lib)
```

## Endpoints Worker (актуально)

| Группа | Путь | Auth |
|---|---|---|
| Telegram bot | `POST /tg` | webhook |
| Mini App | `/v1/bootstrap`, `/v1/expenses` (GET/POST/PUT/DELETE), `/v1/rates` | Telegram `initData` HMAC |
| Web Admin | `/v1/web/*` (expenses/accounts/snapshots/incomes/goals/transactions/categories/dashboard) | Google OAuth → JWT (`Authorization: Bearer`) |
| OAuth | `/v1/auth/google/{start,callback}` | — |
| System (миграции) | `/v1/admin/{references,migrate-expenses,refresh-rates,bulk-rates}` | Bearer `SYNC_TOKEN` |
| Cron | `scheduled` `0 6 * * *` | ежедневный фетч курсов (ADR-006) |
| Health | `GET /healthz` | public |

Архитектура и потоки — `docs/architecture.md`; модель данных — `docs/data-model.md`; решения — `docs/decisions.md`.

## Деплой

```bash
cd cloud/worker && npm run deploy        # wrangler deploy (Worker)
cd cloud/miniapp && npm run deploy       # vite build → wrangler pages deploy dist
cd cloud/admin   && npm run deploy
```

> Деплоить только из смерженного `main` и только после локального UI-теста фронтов (см. `local/README.md` § Тестовые харнесы; правило «frontend-test-locally-before-deploy»).

## Локальная разработка

```bash
cd cloud/worker && wrangler dev          # локальный Worker :8787 (--remote — с реальной D1)
wrangler tail                            # live-логи прод-Worker'а
npm test                                 # vitest (ledger / rates / schemas)
```
