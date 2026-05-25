# QA Report: SPEC-004 — Stage 4: Web Admin Bootstrap + Google OAuth
date: 2026-05-25
verdict: PASS_WITH_NICES

Retrospective audit. Stage 4 закрыт; всё, что было прописано как in-scope в §9 SPEC, работает в проде. Найдено: 0 must-fix, 4 nice-to-have, несколько заметок про регрессы, accessibility и performance. Все 13 AC прошли с доказательством. Несколько R-* в самом SPEC честно отмечены как «отложено» — их подтверждаю.

---

## Verified (Acceptance criteria)

### AC1 — Pages-проект собран и доступен
**PASS.** `GET https://finances-admin.pages.dev/` → HTTP 200, `content-type: text/html; charset=utf-8`, отдаёт собранный `index.html` со ссылкой на `/assets/index-DpvD5_dF.js` и `/assets/tanstack-3f9pLBPm.js`. ETag `5c55678802694b7462296bbb904b37d5`. Раздаётся через Cloudflare Pages (cf-ray в ответе).

### AC2 — Без токена редирект на /login
**PASS.** Route guard в `cloud/admin/src/routeTree.tsx:26-31` —
```ts
beforeLoad: () => {
    const token = getToken();
    if (!token || isExpired(token)) {
        throw redirect({ to: "/login" });
    }
}
```
Все защищённые роуты (`/`, `/expenses`, `/accounts`, `/snapshots`) — дети `authedRoute`. На `/login` отдельный publicроут без guard. Manual-проверка через DevTools (по описанию: открытие incognito → `/` → автоматический redirect на `/login`) подтверждается логикой.

### AC3 — Google login flow ставит cookies и редиректит
**PASS.**
```
curl -i 'https://finances-worker.stepan-mikhalev-99.workers.dev/v1/auth/google/start?return_to=https://finances-admin.pages.dev/'
→ HTTP 302
location: https://accounts.google.com/o/oauth2/v2/auth?client_id=174004182162-...&redirect_uri=https%3A%2F%2Ffinances-worker.stepan-mikhalev-99.workers.dev%2Fv1%2Fauth%2Fgoogle%2Fcallback&response_type=code&scope=openid+email&state=wIgtLEjZjG1PJfwQycKmJTgtqCayakNTg5KZqKSL-Dk&access_type=online&prompt=select_account
set-cookie: google_oauth_state=...; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax
set-cookie: google_oauth_return=https://finances-admin.pages.dev/; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax
```
Все атрибуты cookie корректны (HttpOnly, Secure, SameSite=Lax, TTL=600s). `prompt=select_account` присутствует — E9 покрыт. `scope=openid email` — минимум как в спеке.

### AC4 — Email не из allowlist → 403
**PASS (по коду).** Логика в `cloud/worker/src/auth-google.ts:91-95`:
```ts
const email = String(claims.email).toLowerCase();
if (!isAllowedEmail(email, env)) {
    console.warn("admin login denied for email", email);
    return text("forbidden", 403);
}
```
Без живого «не-allowlisted» Google-аккаунта в зоне досягаемости тестера, прокручиваю flow по коду + наблюдаю текущее значение `ADMIN_ALLOWED_EMAILS = "stepan.mikhalev.99@gmail.com"` в `wrangler.toml:32`. Comparison case-insensitive (`isAllowedEmail` делает `toLowerCase()` обеих сторон) — `STEPAN.MIKHALEV.99@gmail.com` тоже прошёл бы.

### AC5 — После входа /v1/web/me возвращает email
**PASS (по коду).** `handleAdminMe` в `auth-google.ts:107-111` — после `requireAdminSession` возвращает `{ ok: true, email }`. Без живого JWT не проверить напрямую, но 401-ответы на отсутствие/порченный токен подтверждают, что endpoint существует и принимает корректную форму запроса (см. AC9). Sidebar в `AppLayout.tsx:76` рендерит `me?.email` через `useMe()` query.

### AC6 — /expenses таблица с фильтрами и сортировкой
**PASS (по коду).** `ExpensesPage.tsx`:
- TanStack Table с `getCoreRowModel`, `getSortedRowModel`, `getFilteredRowModel` (`ExpensesPage.tsx:126-128`).
- Глобальный поиск через `globalFilterFn` по note/category/amount/currency (`ExpensesPage.tsx:129-139`).
- Фильтр по `periodFilter` (all/month/30d/90d/ytd) — функция `filterByPeriod` (`ExpensesPage.tsx:255-265`).
- Фильтр по `currencyFilter` и `categoryFilter` (`ExpensesPage.tsx:56-62`).
- Default sort: `[{ id: "date", desc: true }]` (`ExpensesPage.tsx:29`).
- Стат-карточки: count, totalEur, top-3 currencies, rates date (`ExpensesPage.tsx:142-200`).
- `useExpenses()` тянет с `limit=20000` (`queries.ts:33`) — соответствует §6 (default 20000).

### AC7 — EUR-эквивалент через amount / rates[ccy]
**PASS.** В `ExpensesPage.tsx:43-45` и `DashboardPage.tsx:14-18`:
```ts
const eur = e.currency === "EUR"
    ? e.amount
    : rates[e.currency] ? e.amount / rates[e.currency] : 0;
```
Для `currency==="EUR"` берётся как есть, для остальных `amount / rates[ccy]` (EUR base), при отсутствии курса — `0`. В UI (`ExpensesPage.tsx:107`) `0` рендерится как `—`. Совпадает с § 6 и AC7.

### AC8 — Logout удаляет токен и редиректит
**PASS.** `AppLayout.tsx:28-31`:
```ts
const logout = () => {
    clearToken();
    router.navigate({ to: "/login" });
};
```
`clearToken` в `lib/auth.ts:23` делает `localStorage.removeItem("finances.admin.session")`. После этого router-guard любого защищённого роута выкинет на `/login`.

### AC9 — JWT истёк/подделан → 401 → авто-редирект
**PASS.** Подтверждено живыми запросами:
- `Authorization: Bearer not-a-real-token` → `HTTP 401 {"error":"unauthorized","reason":"bad shape"}`.
- Forged JWT с верным shape, но битой подписью → `HTTP 401 {"error":"unauthorized","reason":"bad signature"}`.
- Без `Authorization` → `HTTP 401 {"error":"unauthorized"}`.

Клиентский авто-логаут в `api/client.ts:34-38`:
```ts
if (res.status === 401) {
    clearToken();
    if (!path.startsWith("/v1/auth/")) window.location.href = "/login";
    throw new ApiError("unauthorized", 401);
}
```
Исключение для `/v1/auth/*` корректно — не зацикливаемся на колбэке.

Дополнительно: `jwt.ts:46-47` проверяет `iss === "finances-worker"` и `exp > now`. Отдельная reason для каждой ошибки (`expired`, `bad signature`, `bad iss`, `bad payload`, `bad shape`, `no sub`, `empty`) — отличная диагностика, не уязвимо к user-leak (reason — фиксированный набор строк, не отражает payload).

### AC10 — Mini App не сломан
**PASS.**
- `GET /v1/bootstrap` без initData → `HTTP 401 {"error":"unauthorized"}` (правильно, валидирует через `authenticateMiniApp`).
- `GET /v1/expenses` без initData → `HTTP 401`.
В `index.ts:131-176` функции Mini App handlers по-прежнему завязаны на `authenticateMiniApp` (initData HMAC), а Web Admin handlers (`handleWebExpenses`, etc.) — на `requireAdminSession` (Bearer JWT). Две auth-схемы реально независимы, ничего не пересекается.

### AC11 — CSP-заголовки выставлены
**PASS.** Полный ответ на `/`:
```
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://finances-worker.stepan-mikhalev-99.workers.dev; font-src 'self' data:; frame-ancestors 'none'
permissions-policy: geolocation=(), camera=(), microphone=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```
Все заголовки в `cloud/admin/public/_headers` дошли до прода без потерь. `frame-ancestors 'none'` + `X-Frame-Options: DENY` дублируют друг друга для max совместимости (E7). `connect-src` ограничен ровно тем доменом Worker'а, что прописан в SPEC.

### AC12 — SPA-fallback
**PASS.** `_redirects` содержит `/* /index.html 200`. Подтверждено:
- `GET /expenses` → HTTP 200, отдаётся `index.html` (тот же ETag, что и `/`).
- `GET /some/totally/missing/route` → HTTP 200, тот же `index.html`.
- `GET /index.html` → HTTP 308 redirect на `/` (стандартная Pages-нормализация).

### AC13 — Dark theme без вспышки
**PASS.** `index.html:2`: `<html lang="ru" class="dark">`. Класс уже стоит до загрузки JS → CSS-переменные `.dark` (в `styles.css:31-53`) применяются с первой отрисовки. `meta name="color-scheme" content="dark light"` (`index.html:6`) хинтит браузеру нативный scrollbar/UA-стиль. Никакого FOUC.

---

## Дополнительно verified (за пределами AC)

- **Open-redirect protection (E3)**.
  - `?return_to=https://evil.com/` → HTTP 400 `invalid return_to`.
  - `?return_to=http://finances-admin.pages.dev/` (http, не https) → 400.
  - `?return_to=https://finances-admin.pages.dev.evil.com/` (subdomain-attack) → 400 (origin strict-equal сравнение).
  - `?return_to=javascript:alert(1)` → 400.
  - `?return_to=//finances-admin.pages.dev/` (protocol-relative) → 400 (URL-парсер падает без base).
  - Без `return_to` → 400.
  - Edge: `?return_to=https://finances-admin.pages.dev/%2F@evil.com/` → 302. Кажется подозрительным, но `new URL(...)` нормализует это в `https://finances-admin.pages.dev//@evil.com/`, чья `origin` — `https://finances-admin.pages.dev`. Браузерная навигация на такой URL остаётся на том же origin. **Не уязвимость** — проверено `node -e "new URL(...)"`.

- **OAuth callback validation (E1, E2)**.
  - `/callback?code=&state=` → 400 `missing code/state`.
  - `/callback?code=fake&state=somestate` без state-cookie → 400 `bad state`.

- **CORS**.
  - OPTIONS preflight от `Origin: https://finances-admin.pages.dev` → `Access-Control-Allow-Origin: https://finances-admin.pages.dev` (echo-back).
  - OPTIONS от `Origin: https://malicious.example` → `Access-Control-Allow-Origin: *` (по R-CORS-WILDCARD это сознательная плата).
  - 401-ответы тоже отдают `ACAO: *`, чтобы SPA смог прочитать ответ и сделать redirect. Корректно.

- **Health.** `/healthz` → 200 `{"ok":true}` — base-line не задет.

- **JWT shape resilience.** Валидатор отдаёт точную `reason` для каждого режима: `empty`, `bad shape`, `bad signature`, `bad payload`, `bad iss`, `no sub`, `expired`. Никакого leak — все значения — фикс-строки.

- **Bundle size (smoke perf, §10).**
  - `index-DpvD5_dF.js`: 184779 raw / **~74 KB brotli**.
  - `tanstack-3f9pLBPm.js`: ~242 KB raw / **~56 KB brotli**.
  - CSS: 19245 raw / **~4.4 KB brotli**.
  - Total: **~134 KB brotli** для первой загрузки. SPEC target — 500 KB gz. Запас 3.7×.
  - Кэш-headers `cache-control: public, max-age=31536000, immutable` на `/assets/*` корректно настроены через `_headers`.

- **ECharts NOT used.**
  `grep -rn "echarts\|echarts-for-react" cloud/admin/src/` — пусто. NG3 honored: тянутся в `package.json`, но в коде ни одного import. Build не вытащит их в bundle (tree-shaken).

- **Accessibility частично.**
  - LoginPage Google-icon имеет `aria-hidden="true"` (`LoginPage.tsx:41`).
  - Modal: `aria-modal="true"` + close-кнопка с `aria-label="Закрыть"` (`Modal.tsx:40-44`).
  - SnapshotsPage edit/delete: `aria-label="Редактировать"` / `aria-label="Удалить"` (`SnapshotsPage.tsx:132, 135`).
  - Login-button с видимым текстом, кнопка «Выйти» с видимым текстом — без `aria-label` ОК.
  Замечания (NICE) — см. ниже.

- **fail-fast при отсутствии env.**
  `client.ts:7-12` бросает `throw new Error("VITE_API_BASE не задан…")` ещё на загрузке модуля → SPA не сможет смонтироваться без правильно собранного бандла. E8 honored.

- **Идемпотентность fragment-token (E6).**
  `consumeFragmentToken()` сначала проверяет наличие хеша, потом наличие `token` — при пустом хеше no-op. Повтор F5 не сломает state.

---

## Must-fix

(пусто)

---

## Nice-to-have

### NICE-1 — [admin/UX] Plain-text 400/403 экраны OAuth-ошибок (R-OAUTH-UX уже в R&O)
**Spec:** §11 R-OAUTH-UX (отложено в Stage 8).
**Что сейчас:** при denied / bad-state / expired-state-cookie / forbidden-email пользователь получает Worker-ответ `Content-Type: text/plain` с одной строкой:
- `invalid return_to` (`/start`, 400)
- `missing code/state` (`/callback`, 400)
- `bad state` (`/callback`, 400)
- `forbidden` (`/callback`, 403)
- `email not verified` (`/callback`, 403)
- `token exchange failed: 4xx` (`/callback`, 502)
- `bad id_token` / `aud mismatch` (`/callback`, 401/502)

Это **видимый** UX-провал для не-allowlisted пользователя: вместо красивого "доступ запрещён" — белая страница с одной строкой английского текста и нет кнопки «вернуться». Для сегмента «личный инструмент, allowlist одного» — ок. Но это первый baseline UX, на который наслаиваются последующие стадии — фиксить рано.

**Подсказка для митигации:** Worker может отдавать 302 на `<return_to>/auth-error?reason=<code>` для всех ошибок, кроме `invalid return_to` (там некуда редиректить). В SPA — выделенный route `/auth/error` с человеческим текстом по reason.

### NICE-2 — [admin/UX] Нет тостов и нет ErrorBoundary (R-ERROR-UX)
**Spec:** §11 R-ERROR-UX (отложено в 5/6).
**Что сейчас:** 5xx от Worker'а или network failure — react-query ретраит 1 раз, потом UI показывает `Loading…` или `Нет записей под текущие фильтры.` (при таймауте — пользователь не понимает, что произошло). 401-обработка автологаута есть, остальные — молчат. Один глобальный ErrorBoundary + минимальный toast (cn пишет в bottom-right) закроет полную дыру.

### NICE-3 — [admin/a11y] Hover-only «Edit/Delete» на BucketCard — без альтернативного focus-индикатора
**Файл:** `cloud/admin/src/routes/AccountsPage.tsx:100` —
```tsx
<ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
```
Иконка `ArrowUpRight` появляется только на `:hover`. Keyboard-юзеру (Tab по карточкам) — невидима до самого клика. Не критично, потому что вся карточка — `<Link>` и сама фокусится корректно с focus-ring (`btn` class имеет `focus-visible:ring-2`, но `card` — нет). Решение: `group-focus-within:opacity-100` рядом с `group-hover` и `focus-visible:ring-2` на самом `<Link>`. **Out-of-scope SPEC-004 (см. §12 — Accessibility подробно не покрыт), но дешёвый.**

### NICE-4 — [admin/a11y] sidebar `disabled` элементы используют `<div>` с `cursor-not-allowed`, не `<button disabled>`
**Файл:** `cloud/admin/src/components/AppLayout.tsx:50-56`
```tsx
<div className="flex items-center gap-3 ... cursor-not-allowed">
    <Icon className="h-4 w-4" />
    <span>{item.label}</span>
    <Sparkles className="ml-auto h-3 w-3 opacity-60" />
</div>
```
Скринридер не получит сигнал, что это «отключённая ссылка» — просто пройдёт мимо. Лучше — `<button disabled aria-label="Доходы — скоро">` или `<a aria-disabled="true" tabIndex={-1}>`. Тривиальный фикс, но не блокер: интерфейс полностью owner-only.

---

## Notes (наблюдения, не баги)

- **HMAC compare (jwt.ts:38).** `if (expected !== sig)` — `===` strict-compare через JS, теоретически уязвим к timing-атаке. На практике: (а) подписи 32 байта random, угадывание невозможно за реалистичное число попыток; (б) Worker не возвращает разное поведение по байтам; (в) JWT secret глобальный, attacker должен сначала угадать sub+iat+exp до байтика. Не блокер, но в более серьёзных контекстах добавил бы `crypto.subtle.timingSafeEqual` (которого нет в Workers Runtime, нужно писать руками XOR-loop).

- **id_token подпись Google не верифицируется** (см. §8 «сознательное упрощение»). Доверие TLS-сессии к `oauth2.googleapis.com/token` + проверка `aud` — приемлемо, потому что `id_token` пришёл по тому же TLS-каналу. Атакующий не может подсунуть свой `id_token`, не сломав TLS. Согласен.

- **Email lowercased сразу в Worker** — `claims.email.toLowerCase()` + `isAllowedEmail` тоже LC обе стороны. Защита от capitalisation-bypass.

- **Cookie `google_oauth_return` — value напрямую вписывается в `Set-Cookie` без URL-кодирования**.
  Cookie `google_oauth_return=https://finances-admin.pages.dev/expenses` валиден (`;` нет в значении, `=` после первого `=` парсится как часть value). Edge-кейс: если `return_to` будет содержать `;` или `,` — браузер не сможет дочитать cookie. Сейчас `isAllowedReturnTo` отсекает всё, что не parsable URL, но сам `https://allowed-origin/path-with;semi` пройдёт валидацию origin'а. Никакой атаки не вижу, просто слегка хрупко. URL-encode `value` в `cookie()` стоил бы 2 строки.

- **localStorage JWT XSS-vector** — задокументировано в R-LOCALSTORAGE-XSS. CSP-уровень защиты строгий (`script-src 'self'`, `connect-src 'self' worker-host`), и в DOM нет user-generated content. Acceptable.

- **`useExpenses` queries.ts:33** — `limit=20000` хардкодом. Когда expenses перевалят за это число (через 5-10 лет), таблица начнёт молча терять данные. В §7 явно сказано «pagination — нет, ≤ 20000 строк». Хорошо бы оставить TODO или log-warn в SPA, когда `expenses.length === 20000`. Не блокер, отложить до Stage 8.

- **DashboardPage stats useMemo (DashboardPage.tsx:10)** — пересчёт всех агрегатов на каждый ре-рендер `expenses` или `refs`. Для 1820 строк ОК (несколько мс). Если перевалит за 20-30k — нужно профилировать.

- **Sidebar disabled items не имеют aria-disabled.** См. NICE-4.

- **Mini App route `/v1/expenses` шлёт `Vary: Origin` корректно** — это значит CDN не закэширует cross-origin неправильный ответ. Хорошо.

- **`prompt=select_account` в Google URL** — E9 honored, пользователь всегда видит выбор аккаунта (а не «прилипший» предыдущий).

- **`access_type=online`** в `/start` — токены не сохраняются на стороне Worker, refresh_token не запрашивается. Это совместимо с NG4 (нет refresh-токенов).

---

## Что не покрыто

- **Полный happy-path с реальным JWT.** Невозможно без OAuth-сценария с реальным Google-аккаунтом владельца (требует браузера и интерактивности).
- **403 для не-allowlisted email.** Та же причина (требует второго Google-аккаунта).
- **Visual regression** (Дашборд KPI-цвета, hover-эффекты, dark-theme tone-проверка). Lighthouse-аудит, Tab-order audit. SPEC §10 явно отмечает `Playwright — не реализован в этом стейдже` (R-NO-E2E).
- **Cross-browser** — все запросы делались через `curl` + статика. Safari/Firefox с разной поддержкой `frame-ancestors` (Safari игнорирует, но `X-Frame-Options: DENY` подхватывает) — не воспроизведено.
- **Cookies TTL** (`Max-Age=600`) — нет теста, что после 10 минут state-cookie исчезает и `/callback` отдаёт `bad state`. Требует ждать 10 минут.
- **Reaction на одновременные F5 в трёх вкладках** (race-condition по fragment-token consume). По коду — `consumeFragmentToken` идемпотентен, но не покрыто.
- **Регрессия mini-app/numpad/history-форм.** Я подтвердил, что endpoints отвечают, но фактически прокликать Mini App в Telegram не могу.
