# Architecture Review: SPEC-001 Stage 1 — End-to-End MVP
date: 2026-05-25
verdict: APPROVED_WITH_NICES

## Summary

Retrospective audit of the Stage 1 MVP (iPhone → Worker → D1). Implementation matches the spec faithfully: all 12 acceptance criteria are met in code (auth, idempotency via `INSERT OR IGNORE`, silent-for-unauthorized bot policy, soft-delete column, UUID-as-PK). The Worker is small, readable, and avoids over-engineering. The few findings are nice-to-have refinements (type-safety, dead code, CORS hardening for the cross-channel Web Admin) rather than blockers — they accumulated in later stages but are visible in code that touches Stage 1 paths.

## Must-fix (CHANGES_REQUESTED)

None. SPEC-001 acceptance criteria are met and no security-blocker or ADR violation was found in the Stage 1 surface area.

## Nice-to-have

- [security/CORS] `cloud/worker/src/index.ts:320-329` — `pickAllowedOrigin()` falls back to `"*"` for any origin not in the allowlist (including absent `Origin` header). For Mini App endpoints this is OK because auth lives in `X-Telegram-Init-Data` (HMAC-bound, non-cookie), but the same `corsHeaders()` is used by all responses including `/v1/web/*` (Web Admin behind Bearer JWT). For mutating endpoints the response body is currently `{"ok":true,...}` without sensitive data, but echoing `*` weakens defence in depth against a future change that puts sensitive payload into a `POST` response. Suggestion: split into two CORS policies — strict allowlist for `/v1/web/*` and `/v1/admin/*`, permissive `*` for `/v1/*` (Mini App). Out of SPEC-001 scope but touches the same file.

- [types] `cloud/worker/src/db.ts:40,78,82,90,93,125-127` and `cloud/worker/src/index.ts:123,151,204,224,236,252,273,276,289` — many `any` casts. For Stage 1 endpoints the worst offender is `updateExpense(env, id, userId, patch: any)` and `body as any` on `POST /v1/expenses`. Replace with `Partial<ExpensePayload>` for `updateExpense` and a narrowed type-guard for create. The Discriminated-union approach is overkill, but `Pick<ExpensePayload, "id"|"date"|"amount"|"currency">` plus runtime check would catch missing-field bugs at the boundary that the spec already warns about ("trust client; Stage 2 добавит валидацию" — `SPEC-001.md:262`).

- [validation] `cloud/worker/src/index.ts:149-152` `handleCreateExpense` — the spec acknowledges Stage 1 trusts the client, but the body is forwarded directly to D1 with only a "is object" check. Missing required field → SQL bind with `undefined` → cryptic D1 error → 500 (caught by the outer try/catch as `unhandled`). A simple guard `if (!body.id || !body.date || typeof body.amount !== "number" || !body.currency) return json({error:"missing required fields"}, 400, ...)` would convert the failure mode into a deterministic 400. Same pattern was added in `handleWebSnapshotsCreate` (`index.ts:226-228`) — apply that pattern to expenses too.

- [code-quality/dead-code] `cloud/worker/src/bot.ts:133-186` — `_unusedFormatSyncStatus`, `secAgo`, `humanAgo` are dead code left from the pre-pivot sync-status `/sync` command. The leading underscore signals intent, but the symbols are still compiled and referenced. Delete or move to a `legacy/` snapshot. Per `CLAUDE.md` rule "Нет dead code, нет закомментированного кода" and the comment on line 133 itself ("Sync status удалён вместе с pivot"). Touches ADR-011 cleanup discipline.

- [code-quality] `cloud/worker/src/db.ts:90` — `return r.results as any[]` then `cloud/worker/src/index.ts:143` returns `{ expenses: rows }` without a row type. Introducing `ExpenseRow` (mirror of `expenses` columns selected on line 80-81) would document the API contract from `SPEC-001 §6` directly in TypeScript and remove three `any`s along the path.

- [migrations] `cloud/worker/migrations/0001_device_heartbeats.sql`, `0002_expenses_cache.sql` — both create tables that are dropped by `0004_drop_legacy.sql`. They are still in the repo, which is correct (migrations are append-only history). Make sure `schema.sql` snapshot (current) does **not** include these tables — verified: lines 1-93 of `schema.sql` do not mention `device_heartbeats` / `expenses_cache` / `expenses_outbox` / `rate_limit`. Snapshot is consistent with the post-0004 state. No action needed; noting it for future migration reviewers.

- [observability] `cloud/worker/src/index.ts:112-114` — generic 500 response returns `{ error: String(err) }`. For unknown internal errors this leaks the exception message to the client. Spec §8 says "Что не должно попасть в логи" but is silent on response leaks. Suggest replacing with `{ error: "internal" }` while keeping `console.error("unhandled", err)` for `wrangler tail`. Single-user scope makes this low risk, but with public repo any future contributor inherits the leak.

- [bot/parse] `cloud/worker/src/bot.ts:99` — `parseExpense` accepts `[A-Za-z]{3,5}` for the currency token, then `.toUpperCase()`s it. No check against `currencies` table — typos like `EUR0` (no, that fails the alpha-only regex, fine) or `XYZ` (valid format, no real currency) will be inserted. Stage 1 spec §E5 only commits to format-detection error message, not semantic validation. OK for Stage 1, but worth noting as Tech debt for Stage 2 input-validation pass.

## What's good

- ADR-009 silent-bot enforced rigorously: `cloud/worker/src/bot.ts:29-41` checks `isAuthorizedUser` before any side-effect, logs `unauthorized_attempt` as structured JSON, and `return`s without any reply. The placement is correct (before `/start`, before parsing) so even bootstrap commands are silent for non-whitelisted users.

- ADR-005 idempotency: `cloud/worker/src/db.ts:18-21` uses `INSERT OR IGNORE` with the client-supplied UUID PK and returns `inserted: boolean` via `r.meta.changes`. Mirrors the spec verbatim (`SPEC-001 §AC10`). Same pattern applied consistently in `bulkInsertExpenses` (line 93-119).

- ADR-011 D1-centric: no local-DB code paths remain in Worker. The `0004_drop_legacy.sql` migration deliberately drops `expenses_outbox`, `expenses_cache`, `device_heartbeats`, `rate_limit`. Worker `src/` is free of `/v1/sync/*`, heartbeat handlers, or cron-cleanup logic.

- Auth boundary `authenticateMiniApp` (`index.ts:296-305`) is centralized and reused by every `/v1/*` (Mini App) handler. Two-step check (HMAC, then whitelist) returns proper 401 vs 403 distinction. Matches `SPEC-001 §E2/E3`.

- `validateInitData` (`auth.ts:18-55`) implements the Telegram protocol correctly: HMAC-SHA256 key derivation via `HMAC("WebAppData", bot_token)`, sorted `key=value\n…` data-check-string, hex-comparison. Uses Web Crypto API (`crypto.subtle.importKey`/`sign`) — the idiomatic Workers approach. Naming consistent with Telegram docs.

- Owner guard on mutations: `updateExpense` (`db.ts:51`) and `deleteExpense` (`db.ts:71`) both `WHERE id = ? AND user_id = ? AND deleted_at IS NULL`. Even though Stage 1 has a single user, this prevents future-multi-user accidental cross-tenant writes. Matches `SPEC-001 §6` PUT/DELETE contracts.

- Soft-delete consistently applied: `listExpenses` (`db.ts:81`), `getBootstrapData` (`db.ts:183`), `updateExpense` (`db.ts:51`) all filter `deleted_at IS NULL`. Schema index `idx_expenses_active` (partial index `WHERE deleted_at IS NULL`) is present and matches query shape — no full-scan paths on the hot read.

- Parameterized SQL everywhere. `db.ts` and `index.ts:bulk-rates` use `.prepare(...).bind(...)`. No string concatenation. No SQL-injection surface.

- Worker `Env` interface (`types.ts:1-21`) clearly separates `D1Database` binding, Telegram secret, system bearer, and the Web-Admin OAuth/JWT bundle (marked optional — implements ADR-012 graceful degradation when OAuth not configured). Good comment about "Пустые значения = OAuth отключён".

- Spec is honest about retrospective scope and out-of-scope (`§12 OOS1-OOS6`). The audit confirms code stays inside the Stage 1 envelope (no `source='migration'` codepath was added "just in case"; bulk migrate sits behind `SYNC_TOKEN` per `index.ts:288`).

## ADR-conformance

- **ADR-005 (UUID + INSERT OR IGNORE):** ✓ — `db.ts:18-21` (`INSERT OR IGNORE INTO expenses ...`), `db.ts:93-119` (bulk insert idempotent), bot uses `crypto.randomUUID()` on the worker side as a fallback (`bot.ts:74`). Mini App-supplied IDs are accepted via `ExpensePayload.id`.

- **ADR-009 (silent bot):** ✓ — `bot.ts:29-41` returns without `sendMessage` for non-whitelisted users; only logs `event: unauthorized_attempt` JSON with `user_id/username/text_preview` (truncated to 80 chars, per `SPEC-001 §8`).

- **ADR-011 (D1-centric):** ✓ — `migrations/0004_drop_legacy.sql` drops `expenses_outbox`/`expenses_cache`/`device_heartbeats`/`rate_limit`. Worker has no `/v1/sync/*` endpoints, no heartbeat insert, no cron cleanup (cron in `index.ts:50-59` is rates-only, which is post-Stage-1 ADR-006 territory and OOS for this spec but does not violate it).

- **ADR-012 (Web Admin / JWT, allowlist email):** ✓ for SPEC-001 surface — the OAuth/JWT machinery (`auth-google.ts`, `jwt.ts`, `/v1/web/*`) is present but listed as `SPEC-001 §OOS4`. The presence does not affect Stage 1 acceptance. `/v1/web/*` routes correctly go through `requireAdminSession` per spec.

- **ADR-013 (spec-driven workflow):** ✓ — SPEC-001 exists, references ADRs, has acceptance criteria block, follows the documented retrospective track in `docs/process.md §"Двухфазный переход"`.

## Security findings

- **Auth coverage on mutating routes:** ✓ — every `POST/PUT/DELETE /v1/expenses*` calls `authenticateMiniApp()` before reading body. Every `/v1/admin/*` calls `checkBearer(env.SYNC_TOKEN)`. The `/tg` endpoint is internal-auth (whitelist inside the handler) — acceptable per `SPEC-001 §8` because the URL is unguessable and Telegram is the only legitimate caller.

- **No secrets in code:** ✓ — `wrangler.example.toml` uses placeholders (`<YOUR_…>`). The real `wrangler.toml` is gitignored (`.gitignore:14-15`). Secrets (`TELEGRAM_BOT_TOKEN`, `SYNC_TOKEN`, `GOOGLE_*`, `ADMIN_JWT_SECRET`) are listed as `wrangler secret put` items in the example file, never inline.

- **PII / financial logging:** ✓ — `bot.ts` logs only the unauthorized-attempt structured event with truncated `text_preview` (line 37: `.slice(0, 80)`). No logging of `initData` content, no logging of expense amount or currency. `index.ts:55` logs `scheduled rates: saved N for date Y` — non-sensitive.

- **CORS:** ⚠ permissive `*` fallback (see Nice-to-have). For Stage 1 endpoints (Mini App initData-auth, no cookies, no Bearer in browser) the impact is low because there is no ambient credential that another origin could exploit. Worth a follow-up when Web Admin gets a finalised origin.

- **Path-bound id regex:** ✓ — `/^\/v1\/expenses\/([0-9a-fA-F-]+)$/` (`index.ts:80`) is permissive but format-only; combined with `id = ? AND user_id = ?` in SQL, no injection path exists.

- **Telegram webhook secret:** Spec §6 admits `POST /tg` has no auth on the endpoint itself ("URL — secret-by-obscurity"). Telegram supports `secret_token` parameter on `setWebhook` (sent as `X-Telegram-Bot-Api-Secret-Token` header) that would close this gap with no cost. Not blocking for Stage 1 — but worth noting as deferred hardening. The inner whitelist check on `from.id` is the real defence and is solid.

- **Input validation gap on `POST /v1/expenses`:** spec accepts this as Stage 1 limitation. See Nice-to-have above.

## Technical debt notes

These items are **knowingly** deferred to subsequent stages per SPEC-001:

- Strict input validation on `POST /v1/expenses` is deferred to Stage 2 (`SPEC-001 §8` "trust client; Stage 2 добавит валидацию"). Recommend adding a Zod-style schema or hand-written guard during Stage 2.

- Webhook `secret_token` is not used. Reasonable given silent-bot policy + whitelist defence-in-depth, but tracked as hardening for a future security pass.

- D1 database name `finances-outbox` is historical (`SPEC-001 §5`, `§OOS5`). Rename punted to avoid breaking `wrangler.toml` + production webhook.

- Repository root name `excel/` does not match the project scope. Punted (`SPEC-001 §OOS6`, `CLAUDE.md` "Историческая заметка").

- Dead code in `bot.ts` (`_unusedFormatSyncStatus`, `secAgo`, `humanAgo`) left over from pre-pivot `/sync` command. Should be removed in a `chore(worker)` follow-up rather than carried into Stage 2.

- The CORS allow-list logic falls back to `*`. Defendable for Stage 1 (no ambient credentials), but should be tightened when Web Admin moves to a stable origin (it already exists in code per ADR-012, even though `SPEC-001 §OOS4` excludes it).

- Pervasive use of `any` for body payloads. Stage 2 input-validation pass is the natural place to introduce typed boundaries (single shared `ExpenseRow` / `ExpensePatch` types).
