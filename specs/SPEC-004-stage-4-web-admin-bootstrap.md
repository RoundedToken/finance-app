---
id: SPEC-004
title: Stage 4 — Web Admin Bootstrap (React SPA + Google OAuth + read-only расходы)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - adr: docs/decisions.md#adr-012
  - parent: null
  - depends_on: []
---

# Stage 4 — Web Admin Bootstrap

> Retrospective spec. Закрыт по факту реализации; описывает то, что фактически собрано в `cloud/admin/` и в Worker-эндпоинтах `/v1/auth/google/*` + `/v1/web/*`. Используется как baseline для последующих этапов (5/6/7/8) и как onboarding-документ для агентов, попадающих в Web-Admin-домен.

## 1. Context & Problem

После ADR-011 (D1 как ground truth) и ADR-012 (Web Admin как второй UI-канал) Mini App был зафиксирован в scope «ввод и аналитика расходов». Всё остальное (снапшоты, доходы, обмены, дашборды, портфель) уже не помещается ни в экран iPhone 430×932, ни в ограничения Telegram WebView (SVG color-emoji, IndexedDB, clipboard). Нужна отдельная **десктопная** SPA: банковский уровень UX (продвинутые таблицы, multi-panel layouts, keyboard shortcuts) и общий backend (Worker + D1) с Mini App. Stage 4 — это **скелет** этого канала: запустить пустой каркас, прикрутить Google OAuth, отобразить расходы read-only. Дальше — стейджи 5..8 надстраиваются над этим bootstrap'ом.

## 2. Goals

- G1: Поднят отдельный SPA-проект `cloud/admin/` (Vite + React 19 + TS), который билдится и деплоится в Cloudflare Pages (`finances-admin`).
- G2: В Worker добавлен второй auth-канал (Google OAuth 2.0 → HS256 JWT), параллельный существующему Telegram `initData`, без регрессии на Mini App.
- G3: Доступ к админке закрыт allowlist'ом email через `ADMIN_ALLOWED_EMAILS` (CSV, wrangler var).
- G4: Реализован минимальный set админ-эндпоинтов `/v1/web/me`, `/v1/web/expenses`, `/v1/web/references` (Bearer JWT).
- G5: В админке работает страница `/expenses` — TanStack Table с поиском, фильтрами по периоду/категории/валюте, EUR-эквивалентом и сортировкой.
- G6: Sidebar-навигация с местами под будущие разделы (Снапшоты, Доходы, Обмены) в `disabled`-состоянии, чтобы визуально показать roadmap.
- G7: 401 от Worker → автоматический logout + редирект на `/login` в SPA.
- G8: Тёмная тема по умолчанию, hsl design tokens, изумрудный primary; общая визуальная база, на которую опирается весь дальнейший Admin.

## 3. Non-Goals

- NG1: **CRUD расходов из Web Admin** — read-only. Редактирование/создание остаётся в Mini App (Stage 4 — это bootstrap, не feature). Полноценный CRUD откладывается, пока хватает Mini App.
- NG2: **Снапшоты / доходы / обмены / дашборды** — отдельные стейджи (5/6/7/8). Здесь только sidebar-плейсхолдеры с `disabled`.
- NG3: **Графики** — ECharts/echarts-for-react тянутся как зависимость для будущего, но в Stage 4 ни одного графика не строим (KPI-карточки на дашборде — это да, ECharts — нет).
- NG4: **Refresh-токены / rotate-on-use / silent renew** — JWT живёт 30 дней, по истечении пользователь идёт в Google заново.
- NG5: **shadcn/ui-генерация** — компоненты пишем руками поверх Tailwind, без `npx shadcn add`. Tremor тоже не подключаем (вход через свои `card`/`btn-*` Tailwind-utility-классы).
- NG6: **Same-origin (Pages Functions)** — деплоим SPA и Worker на разные origins (`finances-admin.pages.dev` и `finances-worker.*.workers.dev`). Cookies SameSite=None избегаем; JWT носим в Bearer-заголовке.
- NG7: **i18n** — UI только на русском, текстовки захардкожены.
- NG8: **PWA / offline / installable** — не нужны для рабочего инструмента.

## 4. User journeys

### Happy path (первый вход)
1. Пользователь открывает `https://finances-admin.pages.dev/`.
2. SPA проверяет `localStorage["finances.admin.session"]`. Токена нет → редирект на `/login`.
3. На `/login` пользователь жмёт «Войти через Google». Браузер уходит на `${API_BASE}/v1/auth/google/start?return_to=https://finances-admin.pages.dev/`.
4. Worker валидирует `return_to` против `ADMIN_ALLOWED_ORIGINS`, ставит cookies `google_oauth_state` + `google_oauth_return` (HttpOnly, Secure, SameSite=Lax, TTL 10 мин), редиректит на Google consent screen (`scope=openid email`, `prompt=select_account`).
5. Пользователь выбирает Google-аккаунт; Google редиректит на `${API_BASE}/v1/auth/google/callback?code=...&state=...`.
6. Worker: сверяет `state` с cookie, exchange `code` → `id_token` через `oauth2.googleapis.com/token`, декодирует id_token, проверяет `aud`, `email_verified`, `email ∈ ADMIN_ALLOWED_EMAILS` (case-insensitive).
7. Worker подписывает HS256 JWT `{ sub: email, iat, exp = now + 30d, iss: "finances-worker" }`, редиректит на `return_to#token=<jwt>`, чистит state-cookies.
8. SPA на загрузке вызывает `consumeFragmentToken()` → парсит `#token=...`, кладёт в `localStorage`, чистит URL через `history.replaceState`.
9. Route-guard `authedRoute.beforeLoad`: токен есть, `exp > now` → пропускает в `/`.
10. `DashboardPage` параллельно дёргает `useMe()`, `useExpenses()`, `useReferences()`; показывает KPI-карточки (всего трат, в этом месяце, за 30 дней, первая запись).
11. Пользователь переходит на `/expenses` — TanStack Table рендерит ~2000 строк, фильтры/поиск/сортировка работают.

### Happy path (повторный вход, токен жив)
1. Пользователь открывает `/`. `getToken()` возвращает JWT, `decodeClaims()` показывает `exp > Date.now()` → guard пускает.
2. AppLayout рендерится мгновенно, queries автоматически прицепляют `Authorization: Bearer <token>`.

### Happy path (logout)
1. Пользователь жмёт «Выйти» в sidebar.
2. SPA: `clearToken()` → `localStorage.removeItem`, `router.navigate({ to: "/login" })`.

### Edge cases
- E1 — **Email не в allowlist**: callback возвращает 403 `forbidden`. SPA не получит fragment-token и останется на `/login`. (Сейчас экран ошибки не реализован — Worker отдаёт plain text; см. R-OAUTH-UX.)
- E2 — **`state` mismatch** (атака / прошёл TTL=10 min): Worker → 400 `bad state`. Пользователь возвращается на `/login` (через ручную навигацию).
- E3 — **`return_to` не в `ADMIN_ALLOWED_ORIGINS`** (открытый redirect): Worker → 400 `invalid return_to` ещё на этапе `/start`.
- E4 — **JWT истёк / подделан**: любой API-вызов отдаёт 401. `apiFetch` ловит → `clearToken()` + `window.location.href = "/login"`. Исключение — пути, начинающиеся на `/v1/auth/` (для них logout-петля не нужна).
- E5 — **Worker недоступен / 5xx**: `react-query` ретраит один раз; KPI/таблица показывают `Loading…`/`Нет записей`. (Тостер ошибок не реализован; см. R-ERROR-UX.)
- E6 — **Fragment-token уже был «съеден»** (повтор F5): `consumeFragmentToken()` идемпотентен — если хеш пуст, no-op; токен уже в localStorage.
- E7 — **iframe / clickjacking**: `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` блокируют embedding.
- E8 — **`VITE_API_BASE` не задан в сборке**: `client.ts` бросает ошибку прямо на старте — fail-fast, чтобы не задеплоить SPA, которая не знает, куда стучаться.
- E9 — **Изменение email пользователя в Google** (re-login другим аккаунтом): `prompt=select_account` всегда показывает выбор, ничего не «прилипает» бесшумно.

## 5. Data model

D1-схема **не меняется**. Stage 4 — read-only поверх таблиц, которые уже существуют после Stage 1/2/3 (`expenses`, `accounts`, `categories`, `currencies`, `rates`, `authorized_users`).

Что добавляется только в окружение (не схема):

```toml
# cloud/worker/wrangler.toml — env vars (НЕ секреты)
[vars]
ADMIN_ALLOWED_EMAILS  = "stepan.mikhalev.99@gmail.com"
ADMIN_ALLOWED_ORIGINS = "https://finances-admin.pages.dev"
ADMIN_DEFAULT_RETURN_URL = "https://finances-admin.pages.dev/"
GOOGLE_REDIRECT_URI   = "https://finances-worker.<account>.workers.dev/v1/auth/google/callback"
```

```sh
# секреты — через wrangler secret put
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put ADMIN_JWT_SECRET   # 32+ случайных байт
```

Семантика:
- `ADMIN_ALLOWED_EMAILS` — CSV-список нормализованных (lower) email'ов. Проверка через `split(",").map(trim().toLower())`.
- `ADMIN_ALLOWED_ORIGINS` — CSV-список разрешённых `return_to` origins (только `https:`). Защита от open-redirect.
- `ADMIN_JWT_SECRET` — секрет HS256, длина >= 32 байт. Менять только при компрометации (инвалидирует все существующие сессии).
- `ADMIN_DEFAULT_RETURN_URL` — fallback, если cookie `google_oauth_return` пропал; кейс «закладка на /callback».

JWT payload:
```ts
interface JwtPayload {
    sub: string;       // email, lowercase
    iat: number;       // unix seconds
    exp: number;       // iat + 30*86400
    iss: "finances-worker";
}
```

## 6. API contract

Все ответы JSON, заголовки CORS прописаны в `corsHeaders()` (см. `cloud/worker/src/index.ts`). Origin `https://finances-admin.pages.dev` echo-back (точное соответствие из allowlist), иначе `*`.

### `GET /v1/auth/google/start`
- Auth: нет.
- Query: `return_to` — обязателен, должен быть `https:` URL, origin ∈ `ADMIN_ALLOWED_ORIGINS`.
- Behavior: ставит cookies `google_oauth_state`, `google_oauth_return` (HttpOnly, Secure, SameSite=Lax, Max-Age=600), редиректит 302 на Google consent.
- Ошибки: 500 `GOOGLE_CLIENT_ID/REDIRECT_URI not configured`, 400 `invalid return_to`.

### `GET /v1/auth/google/callback`
- Auth: нет.
- Query: `code`, `state`.
- Behavior: проверяет state-cookie ↔ query.state; exchange `code` → `id_token`; декодирует claims; проверяет `aud == GOOGLE_CLIENT_ID`, `email_verified != false`, `email ∈ ADMIN_ALLOWED_EMAILS`; подписывает JWT; 302 на `return_to#token=<jwt>`.
- Ошибки: 400 `missing code/state` / `bad state` / `invalid return_to (cookie)`; 401 `aud mismatch`; 403 `email not verified` / `forbidden`; 502 `token exchange failed` / `no id_token` / `bad id_token`; 500 `ADMIN_JWT_SECRET not configured`.
- Cookies: после успеха обе cookies очищаются (`Max-Age=0`).

### `GET /v1/web/me`
- Auth: Bearer JWT.
- Response 200: `{ "ok": true, "email": "stepan.mikhalev.99@gmail.com" }`.
- Response 401: `{ "error": "unauthorized", "reason": "expired"|"bad signature"|"empty"|... }`.
- Response 403: `{ "error": "forbidden" }` — JWT валиден, но email больше не в allowlist (revocation-by-config).

### `GET /v1/web/expenses`
- Auth: Bearer JWT.
- Query: `limit` (default 20000, SPA шлёт явно), `from` (YYYY-MM-DD, опционально).
- Response 200: `{ "expenses": Expense[] }` — те же ряды, что Mini App видит через `/v1/expenses`, без soft-deleted.
- Response 401/403: см. выше.

### `GET /v1/web/references`
- Auth: Bearer JWT.
- Response 200: `{ accounts: Account[], categories: Category[], currencies: Currency[], rates: { date, base: "EUR", quotes: Record<string, number> } }`.
- Использует `getBootstrapData(env)` — тот же набор, что Mini App, минус telegram-specific поля.

Все `/v1/web/*` проходят через `requireAdminSession(request, env)` (см. `cloud/worker/src/auth-google.ts:114`).

## 7. UI / UX

### Стек и базовые правила
- React 19, Vite 5, TypeScript 5.6 strict.
- TanStack Router (file-less, программно в `routeTree.tsx`), Query, Table.
- Tailwind 3.4 + `tailwindcss-animate`; design tokens в `styles.css` (hsl-переменные), primary — изумрудный.
- **Dark theme по умолчанию** — нет переключателя, нет `prefers-color-scheme`. Светлая не поддерживается.
- Иконки — `lucide-react` (≈10 KB tree-shaken).
- Денежная арифметика — `dinero.js v2`, даты — `date-fns`, валидация — `zod` (для будущих форм).
- ECharts/echarts-for-react — установлен, **не используется** в Stage 4 (готовится под Stage 5b).

### Структура папок
```
cloud/admin/
├── index.html
├── vite.config.ts                    — alias "@/" -> "src/"
├── tailwind.config.ts                — design tokens + animate plugin
├── postcss.config.js
├── tsconfig.json                     — strict, paths "@/*": "src/*"
├── public/
│   ├── _headers                      — CSP + sec-headers (см. §8)
│   └── _redirects                    — "/* /index.html 200" SPA-fallback
└── src/
    ├── main.tsx                      — bootstrap, QueryClientProvider, RouterProvider, consumeFragmentToken()
    ├── routeTree.tsx                 — root → /login + authedRoute → [/, /expenses, /accounts*, /snapshots*]
    ├── styles.css                    — design tokens + .card/.btn-* utilities
    ├── api/
    │   ├── client.ts                 — apiFetch + 401-autologout + googleLoginUrl(return_to)
    │   ├── queries.ts                — useMe/useExpenses/useReferences (+ stage 5: useAccounts/useSnapshots/mutations)
    │   └── types.ts                  — Expense/Account/Category/Currency/RatesPayload/...
    ├── lib/
    │   ├── auth.ts                   — getToken/setToken/clearToken/decodeClaims/isExpired/consumeFragmentToken
    │   └── utils.ts                  — cn, formatAmount, formatDate
    ├── components/
    │   ├── AppLayout.tsx             — sidebar + main outlet; nav с disabled-плейсхолдерами
    │   └── Modal.tsx                 — (Stage 5)
    └── routes/
        ├── LoginPage.tsx             — карточка + Google button
        ├── DashboardPage.tsx         — 4 KPI-карточки, плейсхолдер «здесь скоро будут графики»
        ├── ExpensesPage.tsx          — TanStack Table
        ├── AccountsPage.tsx          — (Stage 5)
        └── SnapshotsPage.tsx         — (Stage 5)
```

### `/login`
```
┌─────────────────────────────────┐
│              €                  │
│           Finances              │
│      Личная финансовая админка  │
│                                 │
│   [G  Войти через Google     ]  │
│                                 │
│   Доступ ограничен: только      │
│   владелец.                     │
└─────────────────────────────────┘
```
- При наличии валидного токена в localStorage — `useEffect` сразу редиректит на `/`.

### AppLayout (sidebar + main)
- 16rem sidebar слева, остальное — main с overflow-y-auto.
- Sidebar: лого (€) + название, nav, внизу — email пользователя + кнопка «Выйти».
- Nav items (Stage 4 baseline):
  - **Дашборд** `/` (active)
  - **Счета** `/accounts` (disabled в Stage 4; активируется в Stage 5)
  - **Снапшоты** `/snapshots` (disabled; Stage 5)
  - **Расходы** `/expenses` (active)
  - **Доходы** `/incomes` (disabled; Stage 6) — иконка `Sparkles` в `ml-auto` показывает «скоро»
  - **Обмены** `/transactions` (disabled; Stage 7)

### `/` (Dashboard)
- 4 KPI-карточки: «Всего трат» (count), «В этом месяце» (sum EUR-eq), «За 30 дней» (sum EUR-eq), «Первая запись» (дата).
- Подсчёт EUR-эквивалента: `amount / rates[currency]` (EUR base), при отсутствии курса — 0 (видно как «—»).
- Внизу — плейсхолдер «Stage 5–8: net worth over time, monthly burn vs income, breakdown по счетам, savings rate».

### `/expenses`
- Card с фильтрами: поиск (search input по note/category/amount/currency), select периода (all/month/30d/90d/ytd), select категории, select валюты.
- Карточка статистики: count, sum EUR-eq, top-3 валют, дата курсов.
- Таблица: Дата | Категория (emoji+name) | Описание | Сумма (raw+ccy) | EUR-эквив | Счёт.
- Сортировка кликом на заголовок, default `date desc`.
- Pagination: **нет** (рассчитываем на ≤ 20000 строк, грузим всё в память; ускорять — когда станет узким местом).

### Loading / empty / error states
- KPI: 4 серых пульсирующих `h-32` skeleton'а.
- Таблица: `Loading…` строка colspan=6, либо «Нет записей под текущие фильтры.».
- 401: автологаут (см. E4), пользователь видит `/login`.
- Прочие ошибки: пока без UI (см. R-ERROR-UX).

## 8. Security

### Auth
- **`/v1/web/*`**: `requireAdminSession(request, env)` — Bearer JWT, `iss == finances-worker`, `exp > now`, `sub == email`, `email ∈ ADMIN_ALLOWED_EMAILS`. Двойная проверка (sig + allowlist) даёт revocation-by-config: убрать email из var → следующий запрос 403, без манипуляций с D1.
- **`/v1/auth/google/start|callback`**: без auth, но защищены allowlist'ом `return_to` (анти-open-redirect), TTL state-cookie (10 минут).
- **Mini App routes (`/v1/expenses`, `/v1/bootstrap`, ...)**: не трогаем — продолжают работать через Telegram `initData` HMAC. Две параллельные auth-схемы.
- **System routes (`/v1/admin/*`)**: продолжают идти через `SYNC_TOKEN` Bearer.

### Cookies / fragment / localStorage
- State-cookies `google_oauth_state` / `google_oauth_return`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`. После использования — `Max-Age=0`.
- JWT передаётся через **URL fragment** (`#token=...`), а не query — fragment не попадает в логи прокси и Referer-заголовки.
- `consumeFragmentToken()` после извлечения чистит URL (`history.replaceState`), чтобы токен не висел в истории/букмарках/share-копии.
- В `localStorage` лежит сырой JWT (риск XSS — приемлемый для personal-tool с CSP). Альтернатива (HttpOnly cookie) требует same-origin или SameSite=None+custom-domain — оба не подходят по архитектуре.

### CSP / headers (`cloud/admin/public/_headers`)
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';   # Tailwind inject runtime styles
  img-src 'self' data:;
  connect-src 'self' https://finances-worker.stepan-mikhalev-99.workers.dev;
  font-src 'self' data:;
  frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```
- `connect-src` явно ограничивает API-host'ом — иначе XSS мог бы качать данные на свой эндпоинт.
- `frame-ancestors 'none'` дублирует `X-Frame-Options: DENY` (CSP3 > XFO для browsers, поддерживающих).

### Input validation
- `return_to`: ловится URL-парсингом + `https:` + точное совпадение origin.
- `code`/`state` query-params: непустые строки, exchange к Google делает остальную валидацию.
- `id_token`: подпись Google **не** верифицируется отдельно (доверяем TLS + claim-проверкам). Это сознательное упрощение — допустимо, потому что код пришёл по тому же TLS-сеансу, и `aud` сверяем.
- `Expense`/`Reference` payloads: типы зафиксированы в `types.ts`, runtime-validation (zod) — не нужен в Stage 4, потому что вся data из своего же Worker.

### PII / финансовые данные в логах
- **Не должны** попадать: `id_token` целиком, `email` в `console.log` без причины, JWT, amounts/categories. В Worker логах допустимы: HTTP-status, путь, length, причина 401/403.
- Сейчас логируется: `console.warn("admin login denied for email", email)` — email допустимо при denied (security event), и `console.error("google token exchange failed", status, body)` — без id_token, только статус.

## 9. Acceptance criteria

- [x] AC1: Pages-проект `finances-admin` собран и доступен по `https://finances-admin.pages.dev/`.
- [x] AC2: Без токена в localStorage и без fragment-token любой path кроме `/login` редиректит на `/login`.
- [x] AC3: Кнопка «Войти через Google» уносит в OAuth-flow и возвращает с `#token=<jwt>` для allowlisted email.
- [x] AC4: Email **не из** `ADMIN_ALLOWED_EMAILS` получает 403 от `/v1/auth/google/callback`, в SPA не возвращается (остаётся вне).
- [x] AC5: После успешного входа `GET /v1/web/me` возвращает `{ ok:true, email }`, sidebar отображает email.
- [x] AC6: `/expenses` показывает рендерит ~1820 строк, фильтры (период/категория/валюта) и поиск работают, сортировка по любому столбцу работает.
- [x] AC7: EUR-эквивалент рассчитывается через `amount / rates[ccy]` (EUR base); при отсутствии курса показывается «—».
- [x] AC8: Кнопка «Выйти» удаляет токен из localStorage и редиректит на `/login`.
- [x] AC9: При истечении JWT или ручной порче токена любой API-вызов получает 401, и SPA автоматически переводит на `/login`.
- [x] AC10: Mini App продолжает работать (`/v1/bootstrap`, `/v1/expenses`) — Telegram `initData` auth не сломан добавлением `/v1/web/*` и `/v1/auth/google/*`.
- [x] AC11: CSP-заголовки выставлены (см. §8) — DevTools Console не ругается на CSP, и iframe-embedding (`<iframe src=...>`) блокируется.
- [x] AC12: SPA-fallback работает: `/expenses` ввод по прямой ссылке без 404 (через `_redirects: /* /index.html 200`).
- [x] AC13: Dark theme применяется без вспышки белого: `<html class="dark">` в `index.html`, дизайн-токены в `styles.css`.

## 10. Test plan

- **Worker (manual smoke)**:
  - `curl -i https://<worker>/v1/web/me` → 401.
  - `curl -i -H "Authorization: Bearer <expired-jwt>" .../v1/web/me` → 401, `reason: "expired"`.
  - `curl -i -H "Authorization: Bearer <valid>" .../v1/web/me` → 200.
  - `curl -i ".../v1/auth/google/start?return_to=https://evil.example.com/"` → 400 `invalid return_to`.
- **Admin SPA (manual)**:
  - Чистый профиль браузера → `/` → редирект на `/login`.
  - Login → consent → возврат с fragment-token → токен в localStorage, URL без `#`.
  - `/expenses`: фильтр period=month + category=Кафе → ожидаемое количество строк.
  - Логаут → пустой localStorage → попытка перейти на `/` → `/login`.
  - В Network вкладке: `Authorization: Bearer ...` прикрепляется ко всем `/v1/web/*`.
- **Mini App regression**: открыть mini-app, проверить что список расходов и POST новой траты работают — auth-разделение не задело.
- **Lighthouse / smoke perf**: первичная загрузка JS ≤ 500 KB gz; страница интерактивна за < 2s на быстром Wi-Fi.
- **Playwright** — **не реализован** в этом стейдже (см. R-NO-E2E).

## 11. Risks & open questions

- R-OAUTH-UX: При denied/expired-flow Worker отдаёт plain-text `forbidden`/`bad state`. Пользователь видит уродливый экран. **Митигация (отложена в Stage 8)**: страница `/auth/error?reason=...` в SPA + Worker редиректит на неё с `?reason=` вместо plain-text.
- R-LOCALSTORAGE-XSS: JWT в localStorage уязвим к XSS. Митигация — строгий CSP (есть), отсутствие inline-скриптов (есть), нет user-generated content в DOM (есть). Принято как acceptable risk для personal-tool.
- R-NO-REFRESH: 30-дневный JWT без refresh-токена. Через 30 дней — повторный Google sign-in. Для personal-tool ок.
- R-ERROR-UX: Нет тостов и глобального error-boundary; ошибки видны только в DevTools. Митигация — добавить простой toaster + ErrorBoundary в Stage 5/6.
- R-NO-E2E: Нет Playwright/Cypress тестов на admin. Митигация — добавить после Stage 7, когда появится много форм (snapshots/incomes/transactions).
- R-CORS-WILDCARD: Для не-allowlist origins `corsHeaders` возвращает `*`. Это безопасно, потому что `/v1/web/*` требуют Bearer (никакие credentials через cookies не передаются), но «выглядит грязно». Митигация — позже жёстко прибить к allowlist.
- R-PAGES-WORKER-SPLIT: SPA и Worker — разные origins. Это плата за бесплатность Pages. Если позже захотим cookie-auth и SameSite=Strict — придётся переезжать в Pages Functions (см. roadmap).
- OQ1 — **closed**: «Использовать ли Telegram Login Widget вместо Google?» — нет (ADR-012, `prompt=select_account` Google проще).
- OQ2 — **closed**: «Класть JWT в HttpOnly cookie через Set-Cookie redirect?» — нет, кросс-origin requires SameSite=None + Secure + custom domain.
- OQ3 — **open**: Когда стоит ввести 2-factor (TOTP) для admin? Текущий уровень риска низкий (личный инструмент, allowlist одного email), но при добавлении CRUD-операций (Stage 5+) — пересмотреть.

## 12. Out of scope для review

- Графики (ECharts тянется как зависимость, в коде не используется).
- Любые CRUD-формы (создание/редактирование/удаление расходов из Web Admin) — Stage 4 строго read-only.
- Светлая тема, мобильный layout sidebar'а (`/expenses` ужимается, но `<lg:` версии sidebar нет — десктоп only).
- Pagination/virtualization таблицы (≤ 20K строк держит без проблем).
- Тосты / global error-boundary / Sentry-интеграция.
- E2E-тесты.
- shadcn/ui — компоненты пишутся руками; никаких `npx shadcn add card button` в этом стейдже.

## 13. Changelog spec'а

- 2026-05-25: создан как retrospective spec (`done`) после реализации Stage 4.
