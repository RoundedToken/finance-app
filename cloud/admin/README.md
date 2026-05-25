# Web Admin (cloud/admin/)

React SPA для Finances. Снапшоты, доходы, обмены, дашборды, портфель. См. ADR-012.

## Стек
- React 19 + Vite + TypeScript.
- TanStack Router / Query / Table.
- Tailwind + кастомные компоненты в `src/components/`.
- ECharts (планируется для графиков снапшотов и дашборда).
- Auth: Google OAuth → JWT HS256 → `Authorization: Bearer` (Worker `/v1/auth/google/*`).
- Deploy: Cloudflare Pages project `finances-admin`.

## Команды

```bash
npm install            # установка зависимостей
npm run dev            # vite dev server на :5174
npm run build          # сборка в dist/
npm run preview        # локальный просмотр прод-сборки
npm run deploy         # build + wrangler pages deploy
```

## Env переменные

`.env.local` (см. `.env.example`):
- `VITE_API_BASE` — URL Worker (по дефолту production).
- `VITE_DEV_PROXY_TARGET` — для разработки с локальным wrangler dev.

## Auth flow

1. SPA проверяет `localStorage.finances.admin.session`.
2. Если нет/expired → редирект на `/login`.
3. Кнопка → `<worker>/v1/auth/google/start?return_to=<spa>` → Google.
4. Google → `<worker>/v1/auth/google/callback` → JWT.
5. Worker редиректит на `<spa>#token=<jwt>`.
6. `consumeFragmentToken()` в `main.tsx` сохраняет токен, чистит URL.

При 401 от API клиент чистит токен и редиректит на `/login`.

## Структура

```
src/
├── main.tsx            ← entry, QueryClient + Router
├── routeTree.tsx       ← маршруты (TanStack Router code-based)
├── styles.css          ← Tailwind base + design tokens
├── components/
│   └── AppLayout.tsx   ← sidebar + outlet
├── routes/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   └── ExpensesPage.tsx
├── api/
│   ├── client.ts       ← fetch с Bearer + 401 handling
│   ├── queries.ts      ← useMe / useExpenses / useReferences
│   └── types.ts        ← payload-типы (зеркало D1 schema)
└── lib/
    ├── auth.ts         ← JWT в localStorage + fragment-token
    └── utils.ts        ← cn(), formatAmount, formatDate
```

## Deploy на Pages (первый раз)

```bash
npx wrangler pages project create finances-admin --production-branch main
npm run deploy
```

После первого деплоя URL будет `https://finances-admin.pages.dev`. Этот URL уже прописан в:
- `cloud/worker/wrangler.toml` → `ADMIN_ALLOWED_ORIGINS`, `ADMIN_DEFAULT_RETURN_URL`.
- `cloud/admin/public/_headers` → CSP `connect-src`.

Если URL отличается — поправить эти места.

## Что планируется (см. roadmap)

- Stage 5: Снапшоты счетов (CRUD + ECharts time series).
- Stage 6: Доходы.
- Stage 7: Транзакции / цепочки обменов.
- Stage 8: KPI дашборд, multi-currency consolidation.
- Stage 9: Инвестиции, yield, holdings.
