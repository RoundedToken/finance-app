# Architecture Review: SPEC-004 Stage 4 — Web Admin Bootstrap (React SPA + Google OAuth)
date: 2026-05-25
verdict: APPROVED_WITH_NICES

## Summary

Implementation faithfully realises SPEC-004 and ADR-012. All 13 acceptance criteria are met in code: SPA scaffold (Vite + React 19 + TanStack), Google OAuth → HS256 JWT, allowlist-based admin gating, `/v1/web/*` Bearer middleware, sidebar-driven layout with disabled placeholders for future stages, and a working `/expenses` TanStack-table. The OAuth flow is small, readable, defensively coded (state-cookie + `return_to` allowlist + `prompt=select_account`), and Mini App auth is genuinely untouched (two parallel `auth*` modules with no shared mutable state). The JWT implementation hand-rolled on Web Crypto is correct in the parts that matter (HMAC always recomputed regardless of header `alg`, payload re-parsed only after signature equality, `iss`/`exp`/`sub` all checked). Findings are nice-to-have refinements — none are merge-blockers. The most user-visible debt is the unfriendly OAuth error UX (already tracked as R-OAUTH-UX in the spec).

## Must-fix (CHANGES_REQUESTED)

None. No SPEC-004 acceptance criterion is broken, no ADR-012 clause is violated, and no security-blocker was found in the surface area covered by Stage 4.

## Nice-to-have

- [security/jwt] `cloud/worker/src/jwt.ts:38` — `if (expected !== sig)` is a plain string `!==`. Both sides are 43-char base64url HMAC-SHA256 digests (constant length), so an attacker cannot leak length, but JS `===`/`!==` short-circuits character-by-character and is not documented as constant-time on Workers V8. The realistic attack surface is small (high jitter on edge, network noise, attacker would need to make ~256^N controlled requests), but this is a low-cost hardening: convert both to `Uint8Array` via `b64urlDecode` and use a constant-time `timingSafeEqual` (XOR-or-into-accumulator loop). Same pattern would also be useful in `cloud/worker/src/auth.ts:60` (`checkBearer`) and the `state` cookie check in `cloud/worker/src/auth-google.ts:61`.

- [security/jwt/defence-in-depth] `cloud/worker/src/jwt.ts:32-50` — verify never inspects the JWT header. Because we always HMAC `${head}.${body}` and reject on mismatch, the classic `alg:"none"` attack is structurally blocked. However adding `JSON.parse(b64urlDecode(head))` and asserting `alg === "HS256" && typ === "JWT"` (before the HMAC, as cheap fail-fast) closes the door to any future refactor that might honour `header.alg`. Spec §5 fixes the algorithm in the contract, the code does not reflect that explicitly.

- [security/oauth/id_token] `cloud/worker/src/auth-google.ts:85-89, 147-157` — `decodeIdToken` just base64-decodes and parses; the RS256 signature is not verified against Google's JWKS. The spec section §8 documents this as a "сознательное упрощение" because the response came over TLS from `oauth2.googleapis.com`, but two notes are worth recording: (1) the code does not even check that the response really came from Google's TLS endpoint — that is enforced by the `fetch(GOOGLE_TOKEN_URL)` constant, fine; (2) more importantly, `claims.email_verified === false` only catches the **explicit-false** case — when Google omits the field (it does for some federated providers and edge-cases), the email is treated as verified. The spec carries this as an open assumption ("Google всегда заполняет это поле"). Safer fail-closed: `if (claims.email_verified !== true) return text("email not verified", 403);`. Difference is small for the single-email allowlist, but fail-closed is the right default for security predicates.

- [security/cors] `cloud/worker/src/auth-google.ts:188-197` — `jsonResponse()` inside `auth-google.ts` hardcodes `Access-Control-Allow-Origin: *` for `/v1/web/me` and the auto-generated 401/403 bodies. The main router in `cloud/worker/src/index.ts:308-330` (`corsHeaders` + `pickAllowedOrigin`) echoes the allowlisted origin instead. So `/v1/web/me` and `/v1/web/*` 401-responses use `*`, while `/v1/web/expenses` 200-responses use the echoed origin. This is the inconsistency the spec captures as `R-CORS-WILDCARD`. Concretely: `requireAdminSession` returns `jsonResponse({error:...}, 401|403)` (auth-google.ts:122, 125, 127) bypassing the central CORS policy. Migrate `requireAdminSession` and `handleAdminMe` to return through `json()` from `index.ts` (pass `request, env`), or pass them as dependencies. Single source of truth for CORS.

- [security/oauth/log-hygiene] `cloud/worker/src/auth-google.ts:78-79` — on `tokenRes.ok === false`, the full Google response body is `console.error`'d. The Google token endpoint never returns `id_token` on the error path, but it can echo back `error_description` containing fragments of the `redirect_uri`/`client_id` (already known), and on `invalid_grant` may include a hashed prefix of the `code`. Risk is low (logs are wrangler tail / CF dashboard only) but mismatch with spec §8: "В Worker логах допустимы: HTTP-status, путь, length, причина 401/403". Suggest logging only `status` + `t.length` + `error` field, not raw body.

- [security/return_to] `cloud/worker/src/auth-google.ts:137-145, 99-104` — origin allowlist is strict (good). However on successful callback the worker calls `appendFragment(returnTo, "token=${jwt}")` (line 100) without re-validating that the cookie-stored `returnTo` is still in the allowlist (it does the check on line 63 — good). But the implementation of `appendFragment` (line 159-162) uses `${sep}${fragment}` where `fragment` is `token=${encodeURIComponent(token)}`. Token is base64url so encodeURIComponent is a no-op for it, but the helper would silently mangle URLs that already contain `#` (it picks `&` as separator). Practically the worker is the only producer of these URLs (`returnTo` is "https://finances-admin.pages.dev/", no hash), so the bug cannot fire today; flagging because the helper is a small footgun if reused elsewhere.

- [security/state-cookie] `cloud/worker/src/auth-google.ts:43-44, 164-166` — `Set-Cookie` for `google_oauth_state` and `google_oauth_return` uses `HttpOnly; Secure; SameSite=Lax`. `Lax` is intentional (browser must send cookie on top-level GET return from Google), correct choice. Worth checking: cookies are set on the Worker origin (`*.workers.dev`), so they only travel back to the Worker for the callback — good. No `__Host-` prefix, which would add `Path=/; Secure; no Domain` enforcement; for a single-domain Worker the `Path=/` is set explicitly, so `__Host-` would be a small uplift. Defence-in-depth, not a real bug.

- [security/jwt-localStorage] `cloud/admin/src/lib/auth.ts:7-29` — JWT in localStorage trade-off is explicitly accepted in R-LOCALSTORAGE-XSS. The mitigation set (CSP with no `'unsafe-eval'`, no inline scripts, no user-generated DOM injection) is in place — verified `cloud/admin/public/_headers:6`. Two small notes: (1) the CSP allows `'unsafe-inline'` for `style-src` due to Tailwind runtime injection; an XSS injecting a `<style>` is harmless but a CSP nonce-based approach exists. (2) `localStorage` is shared across all SPA tabs on the same origin — including any future preview deployment on the same `pages.dev` origin (Cloudflare Pages preview deployments live on `<branch>.<project>.pages.dev`, which is a different origin → not actually shared). Net: accept-as-documented.

- [types] `cloud/worker/src/auth-google.ts:147` — `decodeIdToken(): Record<string, any> | null`. Replace with a narrow interface: `interface GoogleIdTokenClaims { aud: string; email?: string; email_verified?: boolean; iss?: string; exp?: number; iat?: number; sub: string; }` and return that. The `any` propagates into `claims.aud`/`claims.email`/`claims.email_verified` reads in lines 87-89 and would catch e.g. `email_verified` being a non-boolean (Google sometimes returns string `"true"` for legacy providers).

- [types/router-search] `cloud/admin/src/routes/AccountsPage.tsx:79` — `search={{ account_id: acc.id } as any}` cast. The clean fix is to add `validateSearch: (raw): { account_id?: string } => ({ account_id: typeof raw.account_id === "string" ? raw.account_id : undefined })` on `snapshotsRoute` in `cloud/admin/src/routeTree.tsx:53-57`, then the `as any` disappears. Trickles into `SnapshotsPage` where `?account_id=...` deep-link is currently not actually consumed (the page only has a local `filterAccount` state, the route search is dropped). Worth wiring once Stage 5 is in the spec-pipeline.

- [types/period-filter] `cloud/admin/src/routes/ExpensesPage.tsx:170` — `onChange={v => setPeriodFilter(v as any)}`. The `Select` `onChange` callback signature is `(v: string) => void`; downstream `setPeriodFilter` expects the literal-union. Fix is one line on the `Select` component: make it generic over the option value type (or use `as "all" | "30d" | "90d" | "ytd" | "month"` for a *narrow* cast). The current `as any` is the broadest possible cast.

- [error-handling] `cloud/admin/src/api/client.ts:43-46` — `const msg = (body as any)?.error ?? res.statusText ?? "HTTP ${res.status}"`. The fallback chain is fine, but `(body as any)?.error` should be `typeof body === "object" && body !== null && "error" in body ? (body as { error: unknown }).error : ...`. Minor.

- [error-handling/ux] `cloud/admin/src/api/client.ts:33-38` — 401 handler immediately mutates `window.location.href`. Two improvements: (1) if the user is on `/login`, redirecting again is a no-op but the `clearToken` is silent — fine; (2) `apiFetch` swallows the redirect by also throwing `ApiError`, but the throw is a race against the navigation. TanStack Query will catch the throw and not display anything (page is unloading), so behaviourally correct, just brittle. Suggestion: `if (path.startsWith("/v1/auth/")) return throw ApiError;` else `clearToken(); window.location.href = "/login"; return new Promise(() => {});` so the consumer never sees the resolution. Nice-to-have.

- [react-strict] `cloud/admin/src/main.tsx:9` — `consumeFragmentToken()` runs at module load (top-level), before `createRoot`. Under `React.StrictMode` the routing component will still mount once on the first frame, fine. But if a future refactor moves the call into a component body, StrictMode would call it twice — the second call is a no-op because the hash was already cleared. Document this by leaving a one-line comment `// run before mount: hash → localStorage, single-shot` next to the call.

- [react-anti-pattern] `cloud/admin/src/routes/LoginPage.tsx:9-12` — `useEffect` that immediately calls `navigate({to:"/"})` on every render when a valid token is present. This causes a flash of `/login` UI before redirect. Cleaner: use `beforeLoad: () => { if (token && !isExpired(token)) throw redirect({to:"/"}); }` on `loginRoute` mirroring the inverse of `authedRoute.beforeLoad`. (Spec doesn't mandate but the symmetry is nicer.)

- [adr-vs-impl/shadcn] `docs/decisions.md:237` lists shadcn/ui as part of the ADR-012 stack; `SPEC-004 §3 NG5` reverses this ("компоненты пишем руками поверх Tailwind"). The implementation followed the SPEC (no `components/ui/` shadcn-style folder, custom `cn` + Tailwind utility classes `.btn-primary`, `.card`, `.btn-ghost`, `.btn-icon` in `cloud/admin/src/styles.css:63-76`). The mismatch is between **ADR-012 and SPEC-004**, not between SPEC-004 and code. Recommend a one-paragraph follow-up in ADR-012 (or an ADR-012a) explaining why shadcn was dropped: the `npx shadcn add` flow generates Radix-based components that include their own design tokens, conflicting with the hand-rolled hsl-token system. The four utility classes the code actually uses are simple enough that the dependency cost was not worth it. Documenting this prevents a future contributor "fixing" the ADR-stack drift by installing shadcn.

- [yagni] `cloud/admin/package.json:21-22` — `echarts` + `echarts-for-react` are installed but the SPEC explicitly marks them as "Stage 5b" (`SPEC-004 §3 NG3`). YAGNI says do not add a dependency until used; here the intent is to lock the version. Acceptable, but mark in `roadmap.md` Tech debt → "remove if Stage 5b takes >2 weeks past commitment" so the dep doesn't sit in `dist/` chunks even when tree-shaken to zero.

- [dead-code/types] `cloud/admin/src/lib/utils.ts:26-29` — `formatDateTime` is defined but unused (`grep -r formatDateTime cloud/admin/src` returns only the definition). Either delete or use it in `AccountsPage` for the `latest_snapshot.date` formatting.

- [dx/tsconfig] `cloud/admin/tsconfig.json:9-10` — `noUnusedLocals: false`, `noUnusedParameters: false`. Strict-mode TS without these dilutes the safety net. Spec §7 says "TypeScript 5.6 strict" but does not specify these flags; recommend turning them on (will surface the `formatDateTime` deadcode automatically).

- [security/cookies] `cloud/worker/src/auth-google.ts:164` — cookie helper does not URL-encode `value`. `state` is `b64url` (URL-safe by construction, fine). `returnTo` cookie value is the raw URL; URLs can contain `;` `,` ` ` characters which would break cookie parsing. In practice `returnTo` comes from the allowlist which is `https://finances-admin.pages.dev/`-shape (no special chars), so cannot fire today. Defence-in-depth: `encodeURIComponent(value)` on set and `decodeURIComponent` on read in `parseCookies`.

## What's good

- **Two parallel auth modules, zero coupling.** `cloud/worker/src/auth.ts` (Telegram initData) and `cloud/worker/src/auth-google.ts` (Google OAuth) share no mutable state. Mini App regression risk (AC10) is genuinely low because the only shared file is `cloud/worker/src/index.ts` and the additions are pure new-route handlers (lines 88-94) gated on `request.method === "GET"` for `/v1/auth/google/*` and `/v1/web/*`. Spec §2 G2 ("без регрессии на Mini App") is achievable to verify by reading the diff.
- **JWT verify recomputes HMAC over `${head}.${body}` regardless of header content.** This structurally blocks the `alg:"none"` attack and the `alg:"RS256"-with-HS256-secret-as-public-key` confusion attack, even though no header validation is present (see nice-to-have above for the defence-in-depth note).
- **State-cookie is sourced from `crypto.getRandomValues(32)` via `randomState()`** (`cloud/worker/src/jwt.ts:79-83`) — 256 bits of entropy, base64url-encoded, exact length 43. Way more than needed (128 bits is the conventional CSRF threshold), but cheap to produce. The 10-minute TTL is tight; well-chosen.
- **`return_to` allowlist is strict and minimal.** `cloud/worker/src/auth-google.ts:137-145` — `https:`-only, origin-exact-match via `URL.origin`, lowercased. No regex / wildcard / prefix-match. Open-redirect attack surface = zero so long as `ADMIN_ALLOWED_ORIGINS` is correctly configured.
- **JWT travels in URL fragment, not query.** Confirmed at `cloud/worker/src/auth-google.ts:100`. Fragments don't traverse referrer headers / TLS-intermediate logs. The SPA's `consumeFragmentToken` (`cloud/admin/src/lib/auth.ts:32-43`) `history.replaceState`s the URL to drop the fragment before the user can `Cmd+L`-copy. Solid.
- **`requireAdminSession` performs two independent checks**: cryptographic (`verifyJwt` rejects expired/tampered) and policy (`isAllowedEmail` rejects email no longer in the allowlist). This means revocation is `wrangler deploy` away — no token blacklist needed. ADR-012's "revocation-by-config" is correctly implemented.
- **CSP is restrictive and on-spec.** `cloud/admin/public/_headers:6` — `default-src 'self'`, `connect-src 'self' https://finances-worker.<account>.workers.dev`, `frame-ancestors 'none'`. Combined with `X-Frame-Options: DENY` covers clickjacking on browsers with and without CSP3. `script-src 'self'` (no `'unsafe-inline'`/`'unsafe-eval'`) is exactly what an XSS mitigation looks like, and the SPA does not need either (Vite produces clean ES modules).
- **TanStack Router `beforeLoad` is the right place for the guard.** `cloud/admin/src/routeTree.tsx:23-33` — synchronous token check, `throw redirect()` semantics. No flash of `AppLayout`, no race conditions with React render lifecycle. Comparable Mini App auth doesn't have this primitive.
- **Centralised 401 handling at `apiFetch` boundary** (`cloud/admin/src/api/client.ts:34-38`) means every TanStack Query consumer gets autologout for free, including future stage 5+ mutations. Single point of failure also single point of fix. Right level of abstraction.
- **No new D1 migration** in Stage 4 — consistent with `SPEC-004 §5` ("Data model: D1-схема не меняется"). The scope discipline is visible in the file count: `cloud/worker/src/{auth-google,jwt}.ts` are new, `index.ts` got 9 new route mappings, no schema files touched. Faithful read-only stage.
- **Sidebar nav uses `disabled` instead of route-deletion.** `cloud/admin/src/components/AppLayout.tsx:14-21, 49-56` — `Доходы` and `Обмены` are visually present with `Sparkles` "coming soon" indicator. This surfaces the roadmap (G6 in the spec) without 404-ing future deep-links from users who bookmark `/incomes`.
- **EUR-equivalent computation is consistent across pages.** `Dashboard` (`DashboardPage.tsx:14-17`), `Expenses` (`ExpensesPage.tsx:42-45`), `Accounts` (`AccountsPage.tsx:15-19`) all use the same pattern `amount / rates[ccy]`. Cross-page UI shows the same number for the same record. (Tiny DRY violation since this is duplicated — extracting `convertToBase(amount, ccy, rates, base="EUR")` would consolidate four call sites; nice-to-have but spec marks it as Stage 5 territory.)

## ADR-conformance

- **ADR-012 (Web Admin as second UI channel, Google OAuth, JWT allowlist):** ✓
  - Worker exposes `/v1/auth/google/{start,callback}` (`index.ts:88-89`) and `/v1/web/*` (`index.ts:92-102`).
  - JWT HS256, 30-day TTL (`auth-google.ts:16`, `jwt.ts:16`).
  - Allowlist via `ADMIN_ALLOWED_EMAILS` (`auth-google.ts:131-135`).
  - JWT in `Authorization: Bearer`, in localStorage, transported via URL fragment.
  - Two parallel auth schemes coexist on the same Worker.
  - Single deviation: ADR-012 says "rotate on use"; SPEC-004 NG4 explicitly removed this scope. Spec wins (newer document). ADR-012 should be reconciled.
- **ADR-011 (D1 as single source of truth):** ✓ No new local SQLite; admin reads via Worker → D1. `cloud/worker/src/db.ts` is the only D1 client.
- **ADR-009 (silent bot for unauthorized):** ✓ Not touched by Stage 4. `bot.ts` unchanged. No fallback-greetings added.
- **ADR-005 (UUID-on-client + INSERT OR IGNORE):** ✓ Stage 4 is read-only on existing tables; no new entities. Inherited from earlier stages.

## Security findings

Repeated here for emphasis (full discussion above):

1. **id_token signature not verified, `email_verified` not fail-closed** (`auth-google.ts:85-89`). The fail-closed flip (`!== true` instead of `=== false`) is a one-line safer-default.
2. **String `!==` for JWT signature equality** (`jwt.ts:38`) — not constant-time. Practical risk low on Workers; one-time `timingSafeEqual` helper would harden it.
3. **CORS inconsistency** — `auth-google.ts`'s local `jsonResponse` returns `*`; the central `corsHeaders()` in `index.ts` echoes allowlisted origins. Unify.
4. **Error-body logging at OAuth token-exchange failure** (`auth-google.ts:79`) — may leak fragments of `code` in `error_description`. Log status + length only.
5. **State-cookie value is not URL-encoded on set** (`auth-google.ts:164`). Current values are URL-safe; encode for robustness.
6. **No `__Host-` cookie-name prefix.** Defence-in-depth, low priority.

No must-fix-class issues. No secrets in code; `.gitignore` covers `.env`, `wrangler.toml`, generated bundles. `cloud/admin/.gitignore` (lines 1-7) is correct. Spec §8 "PII / финансовые данные в логах" — implementation logs `email` only on `denied` (security event, justified) and never logs JWT/id_token. Aligned with security.md guidance.

## Technical debt notes

Items deliberately deferred by the spec, recorded here so they don't drift:

- **R-OAUTH-UX** — `text("forbidden", 403)` etc. surfaces as raw text. Future: SPA route `/auth/error?reason=…`, Worker redirects on failure paths. SPEC-004 §11 puts this in Stage 8.
- **R-NO-REFRESH** — 30-day JWT without refresh-token. Acceptable for personal tool. Reconsider if Stage 6+ adds heavy CRUD.
- **R-ERROR-UX** — no toast / global ErrorBoundary in SPA. Stage 5/6.
- **R-NO-E2E** — no Playwright/Cypress on admin yet. Spec says post-Stage 7.
- **R-CORS-WILDCARD** — covered above, easy to fix when convenient.
- **R-PAGES-WORKER-SPLIT** — `pages.dev` and `workers.dev` separate origins. Migration to Pages Functions is a future option.
- **shadcn/ui in ADR-012 vs handwritten Tailwind in SPEC-004** — ADR should be amended to reflect the realised choice.
- **ECharts dependency installed but unused.** YAGNI says drop; spec says keep for Stage 5b. Track in roadmap with a "review in 2 weeks" trigger.
- **`formatDateTime` and `noUnusedLocals: false`** allow drift of unused symbols. Tighten the tsconfig when convenient.

No items here are CHANGES_REQUESTED. The implementation is a clean, defensive bootstrap that the next stages can build on without unwinding.
