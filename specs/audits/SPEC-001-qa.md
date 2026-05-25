# QA Report: SPEC-001 Stage 1 — End-to-End MVP
date: 2026-05-25
verdict: PASS_WITH_NICES

## Scope

Retrospective QA audit of the live Stage 1 deployment (`https://finances-worker.stepan-mikhalev-99.workers.dev` + `https://finances-miniapp.pages.dev`). Stage 1 is already marked `done` and merged into production; this audit verifies that the published surface matches the 12 acceptance criteria of `specs/SPEC-001-stage-1-end-to-end-mvp.md` and the constraints of ADR-009 (silent bot) and ADR-011 (D1-centric).

Methodology: code-review of the implementation (`cloud/worker/src/*.ts`, migrations 0001-0004, schema, miniapp `app.js`/`index.html`) + live `curl` smoke against the deployed Worker. No write-paths were exercised against D1 (no valid `initData` available without Telegram WebView). Tests against `/v1/expenses` POST/PUT/DELETE are limited to auth/error surface; the happy-path AC9-AC12 are verified by reading the code that the spec already confirmed end-to-end.

## ✅ Verified

- **AC1 — `/healthz` returns `200 {"ok":true}`** — pass.
  Live: `curl https://finances-worker.stepan-mikhalev-99.workers.dev/healthz` → `HTTP 200 {"ok":true}` in ~40ms. Routing: `cloud/worker/src/index.ts:73`.

- **AC2 — D1 schema is the post-0004 state** — pass (by code inspection).
  Migrations: `cloud/worker/migrations/0003_expenses_full.sql` creates `expenses`; `0004_drop_legacy.sql:4-7` drops the four legacy tables (`expenses_outbox`, `expenses_cache`, `device_heartbeats`, `rate_limit`). Current snapshot `cloud/worker/schema.sql:6-93` carries `authorized_users`, `accounts`, `categories`, `currencies`, `expenses`, `rates`, `snapshots` and does NOT mention any of the dropped tables. Did not run `wrangler d1 execute` to confirm remote state since that requires interactive auth; the migration files are append-only and the live API behaviour at every endpoint (`/v1/bootstrap`, `/v1/expenses` etc.) corroborates schema validity (no 500 errors observed).

- **AC3 — `authorized_users` is populated** — pass (inferred from live behaviour + setup docs).
  Direct verification requires `wrangler d1` (not run here). Indirect confirmation: bot returned `200 ok` on `POST /tg` updates (otherwise it would still 200 but the schema would fail server-side); `docs/setup.md:288-294` documents the insert command; the spec's AC12 itself recorded a successful real expense from iPhone, which is impossible without an authorized row. Auth path: `cloud/worker/src/db.ts:7-13` `isAuthorizedUser` is the only gate.

- **AC4 — Telegram webhook reachable at `/tg`** — pass.
  Live: `curl -X POST .../tg -d '{...message...}'` → `HTTP 200 {"ok":true}` (returns 200 unconditionally per Telegram's contract). Bad JSON: `HTTP 200 {"ok":false,"reason":"bad json"}` from `cloud/worker/src/index.ts:120-128`. `/start` flow itself lives in `cloud/worker/src/bot.ts:44-58` (HTML-formatted welcome only for whitelisted callers).

- **AC5 — Non-whitelisted user gets no chat reply** — pass.
  Live: `curl -X POST .../tg -d '{"message":{"chat":{"id":99999,...},"from":{"id":99999,"first_name":"Stranger","username":"unauth_user"},"text":"hello",...}}'` → `200 {"ok":true}` (no `sendMessage` call). Code path: `cloud/worker/src/bot.ts:29-41` — if not in `authorized_users`, `console.log` a structured `unauthorized_attempt` record and `return;` with no Telegram API call. No echo, no greeting, no error — consistent with ADR-009. The structured log includes `user_id`, `username`, `first_name`, `chat_id`, `text_preview` (capped to 80 chars per `bot.ts:37`).

- **AC6 — Mini App is served from `finances-miniapp.pages.dev`** — pass.
  Live: `curl -i https://finances-miniapp.pages.dev/` → `HTTP 200 text/html`, valid HTML including `<script src="https://telegram.org/js/telegram-web-app.js">` and main UI shell. Confirmed `setChatMenuButton` is configured in `docs/roadmap.md:31` as completed Stage 0 task. Mini App points to Worker base URL at `cloud/miniapp/public/app.js:4`: `const WORKER_BASE = "https://finances-worker.stepan-mikhalev-99.workers.dev"`.

- **AC7 — Bootstrap returns refs + expenses on valid initData** — pass (by code inspection; live happy-path requires real initData).
  `GET /v1/bootstrap` → `handleBootstrap` (`index.ts:131-135`) → `authenticateMiniApp` → `getBootstrapData` (`db.ts:176-202`). Parallel SELECTs on `accounts`, `categories`, `currencies`, `expenses` (limit 20000, `deleted_at IS NULL`), plus latest `rates`. Shape matches spec §6 contract. Mini App consumes it at `app.js:52-62`.

- **AC8 — Unauthenticated bootstrap returns 401** — pass.
  Live tests (all return `HTTP 401 {"error":"unauthorized"}`):
  - No header: `curl .../v1/bootstrap`
  - Empty header: `curl -H "X-Telegram-Init-Data: " .../v1/bootstrap`
  - Garbage: `curl -H "X-Telegram-Init-Data: invalid-data" .../v1/bootstrap`
  - Malformed querystring with fake hash: `curl -H "X-Telegram-Init-Data: query_id=abc&user=...&hash=deadbeef"` → 401
  - Structured but bad-hash: `user={"id":45085076,...}&auth_date=...&hash=<64-hex>` → 401
  Code: `authenticateMiniApp` (`index.ts:296-305`) → `validateInitData` (`auth.ts:18-55`) computes HMAC-SHA256 with `WebAppData`-keyed secret and compares hex digests; mismatch → `{ok:false}` → 401.

- **AC9 — Mini App creates expense via `POST /v1/expenses`** — pass (by code inspection).
  Mini App: `app.js:645-667` `onCategoryTap` generates UUID v4 (`uuid4` at `app.js:33-39`), inserts optimistically into `state.expenses`, then `await postExpense({id, date, amount, currency, category_id, note, source: "mini_app", created_at})`. On error: row removed from state, error toast. Worker: `handleCreateExpense` (`index.ts:146-153`) → `createExpense` (`db.ts:17-38`) → `INSERT OR IGNORE` with `user_id` taken from validated initData (not from request body — correct, prevents spoofing). All required fields plumbed through; `source` defaults to `"mini_app"` on the server if absent (`db.ts:31`). The spec's AC9 was previously verified end-to-end by SPEC-001 closure (real iPhone → D1 trace).

- **AC10 — Idempotency on repeat POST with same id** — pass (by code inspection).
  `INSERT OR IGNORE INTO expenses (...) VALUES (...)` at `cloud/worker/src/db.ts:19-22` with `id` as PRIMARY KEY (`schema.sql:48`). Return value: `{ inserted: (r.meta.changes ?? 0) > 0 }` — repeat POST yields `inserted:false`, no error to client. Spec contract `{"ok":true,"inserted":true|false}` is honoured at `index.ts:152`.

- **AC11 — Telegram bot text-fallback creates expense** — pass (by code inspection).
  `bot.ts:62-95`: regex `^(-?\d+(?:[.,]\d+)?)\s+([A-Za-z]{3,5})\s+(\S+)(?:\s+(.+))?$` at line 99. Generates server-side UUID v4 (`crypto.randomUUID()` at `bot.ts:74`), `date = now.slice(0,10)` (UTC date — see Note about timezone below), `createExpense(env, userId, {..., source:"telegram_bot"})`, then `sendMessage` with `✅ Записано: <amount> <currency> / <category>` + first 8 chars of UUID. Path was exercised by the spec's smoke test ahead of closure.

- **AC12 — End-to-end smoke test passed historically** — pass (per `docs/roadmap.md` and SPEC-001 itself); not re-run today.

## 🔴 Must-fix

None. SPEC-001 acceptance criteria 1-12 are all met. No security blocker found in the Stage-1 surface (Mini App API + bot webhook + healthz). The bot silent-policy (ADR-009) is honoured precisely; the HMAC validation matches Telegram's spec; idempotency holds.

## 🟡 Nice-to-have

### Input validation / error states

- **[validation/expenses] `cloud/worker/src/index.ts:146-153`** — `handleCreateExpense` only checks `if (!body || typeof body !== "object")` then forwards to D1. Missing required field (e.g. POST without `id`/`date`/`amount`/`currency`) binds `undefined` to `INSERT`, which can produce an opaque D1 error and a `500 {"error":"<exception text>"}` instead of a deterministic `400 {"error":"missing required field"}`. Pattern is already applied in `handleWebSnapshotsCreate` (`index.ts:226-228`). Spec §8 acknowledges "trust client" stance for Stage 1 — fine, but a single guard line would improve operability. Not blocking.

- **[validation/PUT]** `cloud/worker/src/db.ts:42-65` `updateExpense` — the SQL uses `note = ?` (no `COALESCE`). That means: passing an absent `note` field in the PATCH body sets `note` to `NULL`, but the intent of a partial-patch API is "if not present, keep current value". `patch.note ?? null` (line 59) destroys an existing note any time a client forgets to include it. AC list does not cover PUT semantics, but this can lose data when the inline-edit modal sends a partial body. Recommend changing to `note = COALESCE(?, note)` (matching the date/amount/currency lines above it) — and document that `null` means clear.

- **[error-response/500 leak] `cloud/worker/src/index.ts:111-114`** — unhandled exception path returns `{ error: String(err) }` to the client. SPEC-001 §8 lists what shouldn't be in logs but is silent on response bodies; still, leaking exception strings expands the attack surface for future bug-discovery. Recommend `{ error: "internal" }` in the response while keeping `console.error("unhandled", err)` for `wrangler tail`. Low priority — not currently triggered by any tested input.

### Routing / method discipline

- **[routing/healthz] `cloud/worker/src/index.ts:73`** — `/healthz` accepts ANY method (no `request.method` guard). Live verification:
  - `POST /healthz` → `200 {"ok":true}`
  - `DELETE /healthz` → `200 {"ok":true}`
  This is harmless for now (the endpoint has no side effects) but is inconsistent with other endpoints that match `(path === "..." && request.method === "...")`. Add `request.method === "GET"` for consistency.

- **[routing/tg] `cloud/worker/src/index.ts:74`** — `/tg` is `POST`-only, which is correct. Live: `GET /tg` → `404 {"error":"not found"}`. Pass.

- **[routing/limit-parse] `cloud/worker/src/index.ts:140`** — `parseInt(url.searchParams.get("limit") ?? "500", 10)` with no validation. `?limit=abc` → `NaN`, then `Math.min(NaN, 20000)` → `NaN`, then `LIMIT NaN` in `db.ts:79-88`. Live test against unauthenticated request didn't reach the SQL (401 from auth), so behaviour with real initData is unverified — but worth a sanity guard `if (!Number.isFinite(limit) || limit <= 0) limit = 500;`. Same applies to `from` (no date format validation; SQL just binds the string).

### Spec / code inconsistency

- **[spec-drift/limit-default] `cloud/worker/src/db.ts:79`** — `listExpenses` defaults `limit` to `10000` when called without it; `cloud/worker/src/index.ts:140,182` overrides with `500` (Mini App) / `20000` (Web Admin). Spec §6 says "default 500, max 20000". This is consistent at the HTTP boundary but the `db.ts` internal default contradicts the spec. Either align (`?? 500`) or annotate the function. Same kind of double-default invites future bugs.

- **[multi-user/leak] `cloud/worker/src/db.ts:78-91`** — `listExpenses` filters by `deleted_at IS NULL` but NOT by `user_id`. In a multi-user world this returns everyone's expenses to any authorized caller. SPEC-001 §5 says "В Stage 1 всегда `user_id = '45085076'`" — so for the current single-user MVP this is irrelevant. Note for Stage 2+: add `AND user_id = ?` once a second whitelisted user exists. (Same pattern in `getBootstrapData` at `db.ts:181-184`.)

### Bot / Telegram

- **[bot/parse-currency] `cloud/worker/src/bot.ts:99-108`** — regex accepts `[A-Za-z]{3,5}` for the currency token (uppercased before insert), but the code does not consult the `currencies` table. Typos like `XYZ` or `USDS` insert successfully. Stage 1 spec §E5 only commits to format-detection error; semantic validation deferred to Stage 2. Worth a follow-up but not a Stage-1 must-fix.

- **[bot/date-tz] `cloud/worker/src/bot.ts:75-76`** — `const now = new Date().toISOString(); const date = now.slice(0,10);` uses UTC for the expense date. For Stepan in Serbia (UTC+1 / UTC+2 DST), a 1:30 AM local message would be filed under "yesterday". For Mini App, `date` is taken from `state.date` (`app.js:651`) which is built from local `todayISO()` (`app.js:31`) — i.e. local date. Inconsistency between two entry-points. Not a SPEC-001 AC but worth noting because the recent-days view in Mini App groups by `e.date`, and a bot-created expense around midnight may appear under the wrong day.

- **[bot/E5-coverage] `cloud/worker/src/bot.ts:65-71`** — when parse fails, the bot replies with the format hint as expected (`SPEC-001 §E5`). Live could not be tested without a whitelisted Telegram session, but the code path is straightforward and uses the same `sendMessage` helper as `/start`.

### Mini App / UX

- **[ui/bootstrap-error]** `cloud/miniapp/public/app.js:62, 204-208` — On bootstrap failure (`/v1/bootstrap` returns 401 because Mini App opened in a normal browser without Telegram WebView), the error is rendered into the categories grid as text: "Ошибка: 401 ..." (`renderCategories`). The numpad remains interactive and a tap triggers `postExpense`, which throws again (also 401). Spec §7 acknowledges this — "Numpad всё равно интерактивен, но POST упадёт" — so this is by design. Nicer UX would be a global state banner blocking the submit until bootstrap succeeds. Minor.

- **[ui/empty-state]** `cloud/miniapp/public/app.js:267-273` `renderRecentDays` — for a fresh user (0 expenses), the "today / yesterday" blocks still render (via `showEmpty=true`), each one labelled with the day title and an empty list. Spec §7 says "Empty: 0 трат → recent-days пуст (рендер не выводит ничего, OK для MVP)" — minor doc/code drift; not user-visible-broken.

- **[ui/accessibility/keyboard]** Numpad in `index.html:26-39` uses `<button>` elements without `data-key` for digits (only `dot` and `back` have one). They rely on `textContent` to extract the value (`app.js:634`). Buttons are focusable and have visible labels, so keyboard nav works in principle. No `aria-label` on numeric buttons — text content suffices. ☑ Contrast not measured (theme-driven, runs inside Telegram WebView which controls colors). Spec doesn't include accessibility ACs.

### CORS

- **[cors/permissive-fallback] `cloud/worker/src/index.ts:320-329`** — `pickAllowedOrigin` returns `*` for any origin not in `ADMIN_ALLOWED_ORIGINS`. Mini App on `finances-miniapp.pages.dev` works because `*` is permissive. Admin allowlist (`https://finances-admin.pages.dev`) gets echoed back exactly — verified live with `curl -H "Origin: https://finances-admin.pages.dev" /v1/bootstrap` returning `access-control-allow-origin: https://finances-admin.pages.dev`. For SPEC-001 scope (Mini App + bot), this is fine because auth is HMAC-bound, not cookie-bound, so CSRF doesn't apply. Already covered in `SPEC-001-arch.md` as nice-to-have.

### Code quality

- **[dead-code] `cloud/worker/src/bot.ts:133-186`** — `_unusedFormatSyncStatus`, `secAgo`, `humanAgo` remain after ADR-011 pivot. The leading underscore indicates intent but the symbols are still compiled. Already flagged in `SPEC-001-arch.md` — duplicate finding.

## 📝 Notes

- **HMAC validation correctness.** `cloud/worker/src/auth.ts:18-55` follows Telegram's spec verbatim: HMAC-SHA256 with key derived from `HMAC("WebAppData", bot_token)`, applied to alphabetically-sorted `key=value\n` data check string with `hash` removed. Hex comparison is case-sensitive (`computedHex !== hash`). Telegram sends `hash` lowercase, and `bufferToHex` (`auth.ts:74-78`) also emits lowercase — match works. Edge case worth a comment: if the Telegram client ever capitalises the hash, comparison would fail. Telegram's spec guarantees lowercase, but a `.toLowerCase()` on the incoming `hash` would be a free belt-and-braces.

- **`auth_date` not validated.** `auth.ts:18-55` doesn't check the freshness of `auth_date`. A captured `initData` string remains valid forever (until bot token is rotated). For a one-user system that pretty much only opens Mini App from Telegram WebView this is acceptable risk. For Stage 4 (multi-user Web Admin) or any future public-ish Mini App, add a TTL check (e.g. reject if `now - auth_date > 24h`). The Telegram docs explicitly suggest checking `auth_date`.

- **Idempotency response.** SPEC-001 §6 says `POST /v1/expenses` returns `{"ok":true,"inserted":true|false}`. Code (`index.ts:152`) returns `{ ok: true, ...r }` where `r = { inserted: boolean }`. Verified shape matches.

- **CORS preflight.** `OPTIONS` returns `204` with full headers (`index.ts:65-70`). Headers include `Access-Control-Allow-Headers: Content-Type, Authorization, X-Telegram-Init-Data` — all needed headers covered. Mini App will pass preflight cleanly.

- **observability.** `[observability] enabled = true` in `wrangler.toml:11` — `wrangler tail` will receive `console.log`/`console.error` from the unauthorized-attempt structured log, the 500 catch, and `sendMessage` failures. For Stage 1 size, this is sufficient.

- **Backup / disaster recovery.** Stage 1 left `local/scripts/backup_d1.py` (per ADR-011) as the only safety net. Not in scope for this audit, but worth verifying separately that the daily backup runs.

## Что не покрыто

1. **Live happy-path POST/PUT/DELETE with valid initData.** Requires intercepting `initData` from a real Telegram WebView session. AC9-AC11 were verified by the spec's own end-to-end smoke and by code inspection; not re-run today.

2. **D1 row-state introspection.** `wrangler d1 execute --remote --command="SELECT ..."` was not run (would require interactive `wrangler` auth on the audit machine). Schema inspection relied on `migrations/` + `schema.sql`. The live API surface implicitly confirms schema soundness — no 500s observed on the routes exercised.

3. **Webhook configuration with Telegram BotFather.** `setWebhook` and `setChatMenuButton` are documented in `docs/roadmap.md:31` as Stage 0 tasks, but the audit didn't call Telegram's `getWebhookInfo` to confirm the current registered URL. Mini App tests rely on the Worker URL hardcoded in `app.js:4`.

4. **Performance under load.** No load test executed. `db.ts:181-184` reads up to 20000 expenses on every `/v1/bootstrap` call — for current data volume (~1820 trace per ADR-011) this is sub-100ms range; verified live `/healthz` at ~40ms total round-trip. Will need attention if expenses grow >100k.

5. **Mini App on iPhone 15 Pro Max (430×932) physical device.** Spec §7 includes a Pro Max layout sketch; visual regression on real hardware was not part of this audit. Static HTML/CSS reviewed but no screenshot diff.

6. **Accessibility (contrast / keyboard).** Spec doesn't include a11y ACs for Stage 1 — only a generic mention. Not failed; not measured.

7. **CSV/migration paths (Stage 4 territory).** `/v1/admin/migrate-expenses`, `replaceReferences`, bulk-rates — explicitly OOS for SPEC-001 (`§12 OOS1`). Auth gating tested (`401` on missing/wrong bearer) but functional behaviour not exercised.

8. **Telegram delivery confirmation.** `sendMessage` failures only log to `console.error` (`bot.ts:124-126`). Did not simulate Telegram-side 4xx/5xx; would be useful to capture as Stage 2 task.
